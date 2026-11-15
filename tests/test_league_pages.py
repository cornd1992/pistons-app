"""Cap room and awards pages were renamed on the stats-site menu.
The parser follows the index link and falls back to the previous filename.
"""
import json, os, sys
from bs4 import BeautifulSoup
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "simba-data"))
import parse

FIX = os.path.join(os.path.dirname(__file__), "fixtures")
def load(name):
    return BeautifulSoup(open(os.path.join(FIX, name), encoding="utf-8").read(), "html.parser")

def test_menu_discovers_new_names_and_ignores_forum():
    hrefs = parse.menu_hrefs_from(load("index2.htm"))
    assert "salaryneeds-new.htm" in hrefs
    assert "monthly-awards.htm" in hrefs
    assert all("proboards" not in h for h in hrefs)

def test_404_page_is_not_usable():
    s = BeautifulSoup("<html><title>404 Not Found</title><body>Not Found</body></html>", "html.parser")
    assert parse.is_real_page(s) is False

def test_caproom_and_awards_from_live_layouts():
    teams = json.load(open(os.path.join(os.path.dirname(__file__), "..", "simba-data", "teams.json")))["teams"]
    cap = parse.parse_cap_soup(load("salaryneeds.htm"), teams)
    det = next(t for t in cap if t["team"] == "Detroit Pistons")
    assert len(cap) >= 29
    assert det["team_id"] == 12
    assert isinstance(det["cap_room"], int) and det["cap_room"] > 0
    assert len(det["committed_by_year"]) == 7
    assert det["committed_by_year"][0] == 60415797
    # The page that currently answers is still about $100M above roster room (cap 49,500,000 − payroll).
    roster_room = 49500000 - det["committed_by_year"][0]
    assert det["cap_room"] - roster_room > 90_000_000
    weekly = parse.parse_award_soup(load("wkly-mnthly.htm"))
    monthly = parse.parse_award_soup(load("monthly-awards.htm"))
    potw = weekly["Player of the Week"]
    kobe = next(r for r in potw if str(r.get("week")) == "8")
    assert kobe["player"] == "Kobe Bryant" and kobe["team"] == "Pistons" and kobe["player_id"] == 163
    assert any(r.get("player") for rows in monthly.values() for r in rows)
    assert "Eastern Conference Player of the Month" in monthly
    print("DET caproom", {k: det[k] for k in ("team","team_id","cap_room","committed_by_year")})
    print("site cap room minus roster room", det["cap_room"] - roster_room)
    print("AWARDS")
    for name, rows in {**monthly, **weekly}.items():
        shown = [r for r in rows if str(r.get("player") or "").strip()]
        print(f"  {name}: {len(shown)} winners; first {shown[0] if shown else None}")
    print("week 8 POTW", kobe)

if __name__ == "__main__":
    test_menu_discovers_new_names_and_ignores_forum()
    test_404_page_is_not_usable()
    test_caproom_and_awards_from_live_layouts()
    print("ok")
