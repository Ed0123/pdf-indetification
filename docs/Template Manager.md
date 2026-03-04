Objective:
Save the templates (Location of Box) in the database and manage them through the UI.

UI:
Update all ui in folder: ui
Main Window:
Add a zone for template management in the main window, which allows users to Add New Template, and apply existing templates to the current page. The template management zone should be placed in the right panel, below the main toolbar and above the data table.
```

 ┌─Template─Manager────────────────────────────────────────────┐
 │  ┌──────────┐┌──────────────────┐┌──────────┐┌──────────┐   │
 │  │   New    ││ Template       ▾ ││  Apply   ││ Manager  │   │
 │  └──────────┘└──────────────────┘└──────────┘└──────────┘   │
 └─────────────────────────────────────────────────────────────┘

```

Template Manager (Pop-up Window):
When the user clicks on the "Manager" button, a pop-up window should appear, displaying a list of existing templates and their details. The user can select a template from the list and apply it to the current page by clicking the "Apply" button. The pop-up window should also have an option to delete templates.

when I click and drag the item in the "Apply to Page" list, I can multiple select the pages in page table and apply the template to all selected pages at once.

```
 ┌────────────────────────────────────────────────────────────────────┐
 │                                                                    │
 │   Template Manager                                                 │
 │                                                                    │
 │                                                                    │
 │   Template                              Apply to Page              │
 │  ┌──────────┬──────────┬───────────┐   ┌──────────┬───────────┐    │
 │  │ Name     │ Ref Page │ Remark    │   │ Page     │ chk       │    │
 │  │──────────┼──────────┼───────────│   │──────────┼───────────│    │
 │  │          │          │           │   │          │           │    │
 │  │          │          │           │   │          │           │    │
 │  │          │          │           │   │          │           │    │
 │  │          │          │           │   │          │           │    │
 │  │          │          │           │   │          │           │    │
 │  │          │          │           │   │          │           │    │
 │  │          │          │           │   │          │           │    │
 │  │          │          │           │   │          │           │    │
 │  │          │          │           │   │          │           │    │
 │  │          │          │           │   │          │           │    │
 │  │          │          │           │   │          │           │    │
 │  │          │          │           │   │          │           │    │
 │  └──────────┴──────────┴───────────┘   └──────────┴───────────┘    │
 │                                        [Apply to Selected Pages]   │
 └────────────────────────────────────────────────────────────────────┘

```

Documentation:
Update the user manual to include instructions on how to use the template manager, including how to create new templates, apply existing templates to pages, and manage templates through the pop-up window. Include screenshots of the new UI elements and step-by-step instructions for each action.
Location: docs\index.html

Test:
Create test cases to verify the functionality of the template manager, including adding new templates, applying templates to pages, and managing templates through the pop-up window. Ensure that the templates are correctly saved in the database and that the UI updates accordingly when templates are applied or deleted.
Location Folder: Test