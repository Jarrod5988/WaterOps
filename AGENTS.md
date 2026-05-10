# WaterOps Codex Instructions

## Main rule

Make small, targeted changes only. Do not rewrite the whole app unless specifically asked.

## Project protection rules

- Do not change pool data unless the task specifically asks for it.
- Do not change chemical targets unless the task specifically asks for it.
- Do not change dosing formulas unless the task specifically asks for it.
- Do not change QR logic unless the task specifically asks for it.
- Do not change PDF report layout unless the task specifically asks for it.
- Do not remove MBS FM branding from reports.
- Do not rename major sections unless specifically asked.
- Do not remove existing jobs, assets, reports, pools, or service modules.
- Do not create duplicate versions of the same feature.

## WaterOps app rules

- The app must work well on iPhone Safari.
- Screens should be compact and usable onsite.
- Avoid horizontal scrolling.
- Avoid service cards being too wide for the phone screen.
- Avoid dark fields where the text becomes hard to read.
- Keep the app professional, clean, and easy to use.
- Prefer improving existing screens instead of creating extra unnecessary screens.

## Report rules

- Reports should remain professional A4 landscape.
- Keep MBS FM branding on generated reports.
- Hide unused chemical dosing lines.
- Show chemical source where relevant, such as Ute stock or stock onsite.
- Do not change report calculations unless specifically asked.
- Do not remove important service information from generated reports.

## QR rules

- QR codes should be able to attach to jobs, assets, rooms, TMVs, filters, and service items where relevant.
- Existing work-generated QR codes should be supported where possible.
- Scanning a QR should open the correct linked job, asset, or service flow.
- Do not break existing QR links when adding new QR features.

## Coding behaviour

- First inspect the relevant files.
- Identify the likely cause before editing.
- Make the smallest safe change.
- Avoid broad rewrites.
- Avoid changing unrelated modules.
- Keep existing working features intact.
- Explain what files were changed.
- Explain what was not changed.
- Provide simple manual test steps.

## Done means

A task is only complete when:

- The exact requested issue is fixed.
- No unrelated parts of the app were rewritten.
- Existing pool, report, QR, job, and asset logic still works.
- The change can be tested on iPhone Safari.
- A clear summary of changed files and test steps is provided.
