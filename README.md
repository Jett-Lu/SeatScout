# SeatScout

SeatScout is a lightweight Firefox browser extension that monitors McMaster University MyTimetable course sections and alerts you when seats open.

It is monitor-only:
- No MacID
- No password
- No auto-enrollment
- No browser automation

SeatScout queries the public MyTimetable class-data endpoint and notifies you when availability changes.

---

## Features

- Monitor multiple courses and sections at once
- Automatic background checking on a configurable interval
- Browser notifications and optional sound alerts
- Simple GUI with two tabs:
  - Watches: add and manage course sections
  - Settings: control interval and notification behavior
- No server, no database, no credentials
- All data stored locally in Firefox

---

## Installation (Firefox)

SeatScout is loaded as a temporary developer extension.

1. Download and unzip SeatScoutExtension_v3.zip
2. Open Firefox and navigate to:
   about:debugging#/runtime/this-firefox
3. Click Load Temporary Add-on
4. Select manifest.json from the extracted folder

The SeatScout icon will appear in the toolbar.

Note: Temporary add-ons are removed when Firefox restarts. This is expected Firefox behavior.

---

## How to Use

### Add a watch

1. Click the SeatScout icon
2. In the Watches tab, enter:
   - Term (example: 3202520)
   - Course code (example: CHEM-1A03)
   - VA (optional, usually leave blank)
3. Click Load sections
4. Select the desired section from the dropdown (for example: LEC C01, TUT 03)
5. Click Add watch

If sections do not load, expand Advanced and manually paste the section name exactly as shown on MyTimetable.

---

### Manage watches

- Enable or disable individual watches
- Enable or disable all watches at once
- Remove watches when no longer needed
- View last known open seats and last check time

---

### Settings tab

All settings are available inside the popup under the Settings tab.

Options:
- Check interval (minutes)
  Recommended: 1 to 2 minutes
- Notify only when open seats increase
- Play ring sound on alert

Settings are stored locally and persist across browser sessions.

---

## What is VA?

VA stands for Variant Attribute.

Some courses have multiple variants in MyTimetable that affect which sections are returned. Most courses do not require this field.

If sections do not load or the dropdown is empty, try entering the VA value shown on the MyTimetable course listing. Otherwise, leave it blank.

## Technical Overview

- Platform: Firefox WebExtension (Manifest V2)
- Storage: browser.storage.local
- Scheduler: browser.alarms
- Data source:
  https://mytimetable.mcmaster.ca/api/class-data
- Notifications: Native Firefox notifications

No external servers or APIs are used beyond MyTimetable.

## Privacy and Safety

- SeatScout does not collect or transmit personal data
- No login credentials are used or stored
- All data remains on the local machine
- This extension only monitors publicly accessible seat availability

## Limitations

- Firefox-only
- Temporary add-on unless signed and published
- If McMaster changes the MyTimetable API, updates may be required

## Roadmap

- Auto-detect current term
- Section search and filtering for large courses
- Chrome (Manifest V3) version
- Signed Firefox Add-ons release
- Multi-university support


## Disclaimer

SeatScout is an independent project and is not affiliated with or endorsed by McMaster University. Use at your own discretion and in accordance with university policies.
