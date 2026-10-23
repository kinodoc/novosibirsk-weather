#!/usr/bin/env python3
"""Refresh the public eclipse list for Novosibirsk from Timeanddate."""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

SOURCE_URL = "https://www.timeanddate.com/eclipse/in/russia/novosibirsk"
OUTPUT = Path("eclipse-data.json")
EVENT_RE = re.compile(
    r"(?P<type>Penumbral|Partial|Total|Annular)\s+"
    r"(?P<kind>Lunar|Solar)\s+Eclipse\s+"
    r"(?P<date>[A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})"
)
TYPE_RU = {
    "Penumbral": "Полутеневое",
    "Partial": "Частное",
    "Total": "Полное",
    "Annular": "Кольцеобразное",
}
KIND_RU = {"Lunar": "лунное", "Solar": "солнечное"}


def main() -> None:
    response = requests.get(
        SOURCE_URL,
        headers={"User-Agent": "NovosibirskWeatherEclipseUpdater/1.0"},
        timeout=30,
    )
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    page_text = soup.get_text(" ", strip=True)

    events = {"lunar": [], "solar": []}
    seen: set[tuple[str, str]] = set()
    today = date.today()

    for match in EVENT_RE.finditer(page_text):
        try:
            event_date = datetime.strptime(match.group("date"), "%b %d, %Y").date()
        except ValueError:
            continue
        if event_date < today:
            continue

        source_kind = match.group("kind")
        kind = source_kind.lower()
        key = (kind, event_date.isoformat())
        if key in seen:
            continue
        seen.add(key)

        events[kind].append({
            "date": event_date.isoformat(),
            "type": f'{TYPE_RU[match.group("type")]} {KIND_RU[source_kind]} затмение',
        })

    for kind in events:
        events[kind].sort(key=lambda event: event["date"])

    # Fail closed: never replace valid data with an empty/partial scrape.
    if len(events["lunar"]) < 1 or len(events["solar"]) < 1:
        raise SystemExit(
            "Could not parse both lunar and solar eclipses; keeping existing data."
        )

    payload = {
        "location": "Новосибирск",
        "source": SOURCE_URL,
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        **events,
    }
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f'Updated eclipse data: {len(events["lunar"])} lunar, '
        f'{len(events["solar"])} solar events.'
    )


if __name__ == "__main__":
    main()
