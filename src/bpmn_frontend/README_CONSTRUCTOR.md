# BPMN Constructor - User Guide

## Overview

The BPMN Constructor is a user-friendly, rule-based tool for building BPMN (Business Process Model and Notation) diagrams without any AI integration. Everything is driven by user input through an intuitive interface.

## Features

- **Visual Constructor Interface**: Build diagrams by adding and editing elements in a hierarchical tree structure
- **Real-time Diagram Preview**: See your diagram update automatically as you build it
- **Multiple Element Types**: Support for Start Events, End Events, Tasks, Conditions (If/Else), Multiple Conditions, and Parallel Processes
- **Nested Structures**: Create complex nested conditions and loops
- **Validation**: Real-time validation ensures your diagram is complete and correct
- **Undo/Redo**: Full history support with undo/redo functionality
- **Export Options**: Export as BPMN XML, PNG, or SVG
- **Templates**: Pre-built templates for common patterns
- **Modern UI**: Clean, responsive design with drag-and-drop support

## Getting Started

### Interface Layout

- **Left Panel**: Constructor panel where you build your diagram structure
- **Right Panel**: Live preview of the BPMN diagram

### Building a Diagram

1. **Add Elements**: Click the "Add Element" button to add new elements to your process
2. **Edit Elements**: Click on element labels to edit them inline
3. **Add Branches**: For gateways (conditions), add branches and define conditions
4. **Nest Elements**: Add elements within branches to create nested structures
5. **Delete Elements**: Use the delete button (trash icon) to remove elements

### Element Types

#### Start Event
- Marks the beginning of a process
- Required: Every process must have exactly one start event
- Example: "Receiving Application"

#### End Event
- Marks the end of a process
- Required: Every process must have at least one end event
- Example: "Application Registered"

#### Task
- Represents work to be performed
- Types: Task, User Task, Service Task, Script Task, Business Rule Task, Send Task, Receive Task, Manual Task
- Example: "Check Data Correctness"

#### If Condition (Exclusive Gateway)
- Represents a decision point with mutually exclusive branches
- Each branch has a condition (e.g., "Data correct", "Data incorrect")
- Example: Split into "Yes" and "No" paths

#### Multiple Conditions (Inclusive Gateway)
- Represents multiple conditions that can be true simultaneously
- Supports default branches
- Example: "Payment confirmed AND Item in stock"

#### Parallel Processes (Parallel Gateway)
- Represents processes that run simultaneously
- All branches must complete before continuing
- Example: "Prepare Specification" and "Form Budget" running in parallel

## Example Workflows

### Example 1: Simple Condition

1. Add Start Event: "Receiving Application"
2. Add Task: "Check Data Correctness"
3. Add If Condition
4. Add branch with condition "Data correct" → Add Task "Register Application"
5. Add branch with condition "Data incorrect" → Add Task "Request Clarifications"
6. Add End Event: "Application Registered / Denied"

### Example 2: Parallel Processes

1. Add Start Event: "Project Launch"
2. Add Parallel Processes gateway
3. Add branch → Add Task "Prepare Technical Specification"
4. Add branch → Add Task "Form Budget"
5. Add If Condition
6. Add branch "Spec ready AND Budget approved" → Add Task "Start Implementation"
7. Add branch "At least one not done" → Add Task "Rework"
8. Add End Event: "Project Launched"

### Example 3: Nested Conditions

1. Add Start Event: "User Online Registration"
2. Add Task: "Check Email"
3. Add If Condition
4. Add branch "Email confirmed":
   - Add nested If Condition
   - Add branch "Age ≥ 18" → Add Task "Create Account"
   - Add branch "Age < 18" → Add Task "Deny Registration"
5. Add branch "Email not confirmed" → Add Task "Reminder"
6. Add End Event: "Registration Complete / Denied"

## Using Templates

1. Click the templates icon (document icon) in the header
2. Select a template from the list
3. The template will load and replace your current process (with confirmation)
4. Customize the template as needed

## Keyboard Shortcuts

- **Ctrl+Z / Cmd+Z**: Undo
- **Ctrl+Y / Cmd+Y**: Redo
- **Enter**: Submit input fields
- **Delete**: Remove selected elements (when focused)

## Export Options

### Export BPMN XML
- Click "Export BPMN XML" button
- Downloads a `.bpmn` file that can be opened in BPMN tools

### Export PNG
- Click "Export As" → "PNG Image"
- Downloads a PNG image of the diagram

### Export SVG
- Click "Export As" → "SVG Image"
- Downloads an SVG image of the diagram

## Validation

The constructor validates your diagram in real-time:

- ✅ Ensures at least one start event exists
- ✅ Ensures at least one end event exists
- ✅ Validates that parallel gateways don't have empty branches
- ✅ Validates nested structures recursively

Validation errors are shown in red at the bottom of the constructor panel.

## Tips

1. **Start Simple**: Begin with a basic flow and add complexity gradually
2. **Use Templates**: Start from templates for common patterns
3. **Name Clearly**: Use descriptive names for elements and conditions
4. **Test Conditions**: Ensure your conditions are mutually exclusive for exclusive gateways
5. **Check Validation**: Always ensure validation passes before exporting

## Troubleshooting

### Diagram not updating
- Check validation errors - invalid diagrams won't render
- Ensure you have a start event and at least one end event

### Can't add elements
- Make sure you're clicking the correct "Add Element" button
- For gateways, add elements within branches, not after the gateway

### Export not working
- Ensure validation passes (green checkmark)
- Make sure your diagram has at least a start and end event

## Technical Details

- Built with Vue 3 and Vuetify 3
- Uses bpmn-js for diagram rendering
- Pure JavaScript BPMN XML generation (no backend required for basic functionality)
- Supports BPMN 2.0 standard

## Support

For issues or questions, please refer to the project documentation or create an issue in the repository.

