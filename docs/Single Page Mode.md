Objective:
If there is too many data, the page will be too long and hard to navigate. In this case, we can use single page mode to show the data for single page only.

How to use:
1. Enable the "Single Page Mode" checkbox located in the **main toolbar** (top of the window), next to the other file actions.

UI:
```

 ┌───────────────────────────────────────────────────────────────────────────────┐
 │                                                     ┌──────────┐ ┌──────────┐ │
 │   File | #Page                                      │ ← Previ… │ │  Next →  │ │
 │                                                     └──────────┘ └──────────┘ │
 │ ───────────────────────────────────────────────────────────────────────────── │
 │ ╭────────────────────────────────────┬──────────────────────────────────────╮ │
 │ │ Attribute                          │ Extracted Data                       │ │
 │ │────────────────────────────────────┼──────────────────────────────────────│ │
 │ │                                    │                                      │ │
 │ ╰────────────────────────────────────┴──────────────────────────────────────╯ │
 │                                                                               │
 │                                                                               │
 │                                                                               │
 │                                                                               │
 │                                                                               │
 │                                                                               │
 │                                                                               │
 │                                                                               │
 │                                                                               │
 │                                                                               │
 │                                                                               │
 │                                                                               │
 │                                                                               │
 │ ┌──────────┐┌──────────┐                                                      │
 │ │ +Add Col ││ -Remove… │                                                      │
 │ └──────────┘└──────────┘                                                      │
 └───────────────────────────────────────────────────────────────────────────────┘

```
- After enabling single page mode using the checkbox in the viewer toolbar, the page will only show the data for current page. You can use the Previous and Next buttons to navigate between pages. The page number will be displayed at new mode window.
- If there is no data for current page, the corresponding row for extracted data will be empty. You can still add new column and fill in the data for current page.
- All behavior of single page mode is the same as normal mode, except that it only shows data for current page. You can click the row to edit the data and focus the box in PDF viewer.
- The user can adjust and sort the table. But before updating the data, the application should temp disable the sorting and adjusting behavior to avoid the data loss. After the data is updated, the sorting and adjusting behavior will be re-enabled.
- All data will be cocurrenlty updated to the backend of internal data memory, so the data will not be lost when switching between pages. The user can switch between pages without worrying about losing data.
- when select the row, the row will be highlighted, so the user can easily identify which row is selected.
- All UI saved in folder: ui

- Documentation:
Update the documentation to include the new single page mode feature. The documentation should include the following sections:
- Introduction: A brief overview of the single page mode feature and its benefits.
- How to Use: A step-by-step guide on how to enable and use the single page mode feature.
- UI: A description of the user interface changes when single page mode is enabled, including the new Previous and Next buttons and the page number display.
- Behavior: A detailed explanation of how the single page mode behaves, including how it handles data for each page, how it allows users to add new columns and fill in data, and how it manages sorting and adjusting behavior.
- Conclusion: A summary of the single page mode feature and its advantages for users who need to manage large amounts of data.
- Location: docs\index.html

- Testing:
Test the single page mode feature to ensure that it works as expected. The testing should include the following scenarios:
- Ensure sorting and adjusting behavior do not affect the data when updating the data in single page mode.
- Ensure that the Previous and Next buttons work correctly to navigate between pages.
- Ensure that the page number is displayed correctly when single page mode is enabled.
- Ensure that the data for each page is displayed correctly and that users can add new columns and fill in data without losing any existing data.
- Ensure that the row highlighting works correctly when a row is selected.
- Ensure that the UI changes are consistent with the design specifications.
- Ensure data is correctly updated to the backend of internal data memory when switching between pages.
- Location: tests\single_page_mode_test.py

