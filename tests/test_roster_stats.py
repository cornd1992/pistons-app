"""Roster Player Statistics is the only per-player line the stats site updates after tip-off.

Profile Season Averages and playerNstats.htm stay at 0. The roster table has Name/Games/MPG
and no ID column; parsing used to require an ID header and dropped every row.
"""
import os, sys
from bs4 import BeautifulSoup
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "simba-data"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import parse, build

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "roster_player_stats.html")

def soup():
    return BeautifulSoup(open(FIXTURE, encoding="utf-8").read(), "html.parser")

def test_roster_table_without_id_column():
    r = parse.parse_roster_soup(soup())
    assert r["record"]["w"] == 4 and r["record"]["l"] == 5
    by = {p["player_id"]: p for p in r["players"]}
    assert set(by) == {252, 163}
    fos = by[252]["season_stats"]
    assert fos["games"] == 9
    assert fos["mpg"] == 29.3
    assert fos["ppg"] == 7.4
    assert fos["rpg"] == 8.1
    assert fos["topg"] == 1.2  # site header is TPG
    assert fos["fg_pct"] == 0.568
    assert by[252]["salary"]["year_1"] == 5000000
    assert by[163]["season_stats"]["games"] == 0
    assert by[252]["ratings"]["in"] == "C"

def test_box_uses_roster_line_and_does_not_invent_attempts():
    fos = parse.parse_roster_soup(soup())
    st = next(p["season_stats"] for p in fos["players"] if p["player_id"] == 252)
    box = build.box_of({
        "season_averages": {"games": 0, "ppg": 0, "mpg": 0},
        "stats": {"seasons": [{"season": "2005", "team": "Pistons", "games": 0, "ppg": 0,
                               "fg": 0, "fga": 0, "ft": 0, "fta": 0, "three_p": 0, "three_pa": 0}]},
        "roster_stats": st,
    })
    assert box["gp"] == 9
    assert box["ppg"] == 7.4
    assert box["topg"] == 1.2
    assert box["has_shooting"] is False
    assert box["fga"] == 0 and box["fta"] == 0
    assert box["fg_pct"] == 0.568

def test_real_shooting_line_wins_over_roster():
    st = next(p["season_stats"] for p in parse.parse_roster_soup(soup())["players"] if p["player_id"] == 252)
    box = build.box_of({
        "season_averages": {"games": 8, "ppg": 20, "mpg": 30},
        "stats": {"seasons": [{"season": "2005", "games": 8, "ppg": 20, "fg": 80, "fga": 160,
                               "ft": 40, "fta": 50, "three_p": 8, "three_pa": 24}]},
        "roster_stats": st,
    })
    assert box["gp"] == 8
    assert box["ppg"] == 20
    assert box["has_shooting"] is True
    assert box["fga"] == 20  # 160 attempts / 8 games

def test_box_score_shooting_is_exact():
    """Game box scores publish FG/FGA. One made/attempt line must not be treated as a percentage guess."""
    html = """<table><tr><th>Celtics</th><th>POS</th><th>MIN</th><th>FG</th><th>FGA</th><th>3P</th><th>3PA</th>
      <th>FT</th><th>FTA</th><th>REB</th><th>A</th><th>PF</th><th>ST</th><th>TO</th><th>BL</th><th>PTS</th></tr>
      <tr><td>Jamaal Tinsley</td><td>PG</td><td>36</td><td>7</td><td>15</td><td>2</td><td>5</td><td>4</td><td>6</td>
      <td>4</td><td>8</td><td>2</td><td>1</td><td>3</td><td>0</td><td>20</td></tr>
      <tr><td><b>TEAM TOTALS</b></td><td></td><td></td><td>30</td><td>80</td><td>5</td><td>15</td><td>10</td><td>12</td>
      <td>40</td><td>20</td><td>18</td><td>8</td><td>12</td><td>4</td><td>75</td></tr>
      </table>"""
    lines = parse.parse_box_soup(BeautifulSoup(html, "html.parser"))
    assert len(lines) == 1 and lines[0]["name"] == "Jamaal Tinsley"
    assert lines[0]["fga"] == 15 and lines[0]["fg"] == 7 and lines[0]["ast"] == 8 and lines[0]["tov"] == 3
    players = [{"player_id": 589, "name": "Jamaal Tinsley", "team": "Detroit Pistons", "team_id": 12}]
    teams = [{"team_id": 12, "name": "Detroit Pistons"}]
    missed = parse.attach_box_totals(players, lines, teams)
    assert missed == []
    bt = players[0]["box_totals"]
    assert bt["games"] == 1 and bt["fga"] == 15 and bt["pts"] == 20
    box = build.box_of({"season_averages": {"games": 0, "ppg": 0}, "stats": {"seasons": [{"season": "2005", "games": 0, "fg": 0, "fga": 0, "ft": 0, "fta": 0, "three_p": 0, "three_pa": 0}]},
                        "roster_stats": {"games": 9, "ppg": 13.8, "fg_pct": 0.477}, "box_totals": bt})
    assert box["has_shooting"] is True
    assert box["fga"] == 15 and box["fgm"] == 7 and box["fta"] == 6 and box["ppg"] == 20
    # TS% = 20 / (2 * (15 + 0.44*6)) = 20 / 35.28
    assert abs(box["ppg"] / (2 * (box["fga"] + 0.44 * box["fta"])) - 20 / 35.28) < 1e-9

def test_two_games_add_and_zero_attempts_do_not_invent_shooting():
    line={"team":"Pistons","name":"Jamaal Tinsley","min":30,"fg":5,"fga":10,"three_p":1,"three_pa":2,"ft":2,"fta":2,"reb":3,"ast":6,"pf":1,"stl":1,"tov":2,"blk":0,"pts":13}
    players=[{"player_id":589,"name":"Jamaal Tinsley","team":"Detroit Pistons","team_id":12}]
    teams=[{"team_id":12,"name":"Detroit Pistons"}]
    assert parse.attach_box_totals(players,[line,dict(line)],teams)==[]
    assert players[0]["box_totals"]["games"]==2 and players[0]["box_totals"]["fga"]==20
    quiet=build.box_of({"season_averages":{"games":0},"stats":{"seasons":[]},
        "box_totals":{"games":1,"min":3,"fg":0,"fga":0,"ft":0,"fta":0,"three_p":0,"three_pa":0,"pts":0,"reb":1,"ast":1,"stl":0,"blk":0,"tov":0}})
    assert quiet["has_shooting"] is False and quiet["gp"]==0

if __name__ == "__main__":
    test_roster_table_without_id_column()
    test_box_uses_roster_line_and_does_not_invent_attempts()
    test_real_shooting_line_wins_over_roster()
    test_box_score_shooting_is_exact()
    test_two_games_add_and_zero_attempts_do_not_invent_shooting()
    print("ok")
