# Forms Extension

**Extension ID**: `cdx.forms`
**Version**: 0.1
**Status**: Draft

## 1. Overview

The Forms Extension enables interactive form fields within documents:

- Text inputs and text areas
- Checkboxes and radio buttons
- Dropdowns and date pickers
- Validation rules
- Form submission

## 2. Extension Declaration

```json
{
  "extensions": [
    {
      "id": "cdx.forms",
      "version": "0.1",
      "required": false
    }
  ]
}
```

## 3. Form Block Types

### 3.0a Form Container

The `forms:form` block is a container that groups form fields together. It wraps child form field blocks and provides submission configuration.

```json
{
  "type": "forms:form",
  "id": "contact-form",
  "action": "https://api.example.com/submit",
  "method": "POST",
  "encoding": "application/json",
  "children": [...]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"forms:form"` |
| `id` | string | No | Unique form identifier |
| `action` | string (URI) | No | Form submission endpoint/handler URL |
| `method` | string | No | HTTP method for submission. One of: `GET`, `POST`. Defaults to `"POST"`. |
| `encoding` | string | No | Form encoding type. Defaults to `"application/json"`. |
| `children` | array | Yes | Array of form field blocks and submit buttons |

### 3.0b Submit Button

The `forms:submit` block renders a submission button within a form.

```json
{
  "type": "forms:submit",
  "label": "Send Message"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"forms:submit"` |
| `id` | string | No | Unique block identifier |
| `label` | string | No | Button text. Defaults to `"Submit"`. |

### 3.1 Text Input

```json
{
  "type": "forms:textInput",
  "name": "fullName",
  "label": "Full Name",
  "placeholder": "Enter your name",
  "required": true,
  "maxLength": 100,
  "validation": {
    "pattern": "^[A-Za-z ]+$",
    "message": "Name must contain only letters and spaces"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"forms:textInput"` |
| `name` | string | Yes | Field name for form data |
| `label` | string | No | Display label |
| `placeholder` | string | No | Placeholder text |
| `required` | boolean | No | Whether field is required. Defaults to `false`. |
| `disabled` | boolean | No | Whether field is disabled. Defaults to `false`. |
| `inputType` | string | No | Input type. One of: `text`, `email`, `password`, `tel`, `number`. Defaults to `"text"`. |
| `maxLength` | integer | No | Maximum character length |
| `autocomplete` | string | No | Autocomplete hint |
| `validation` | object | No | Validation rules (see section 4) |
| `conditionalValidation` | object | No | Conditional validation rules (see section 4.3) |
| `fallback` | object | No | Fallback block for non-forms viewers (see section 7) |

### 3.2 Text Area

```json
{
  "type": "forms:textArea",
  "name": "comments",
  "label": "Additional Comments",
  "rows": 4,
  "maxLength": 1000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"forms:textArea"` |
| `name` | string | Yes | Field name for form data |
| `label` | string | No | Display label |
| `placeholder` | string | No | Placeholder text |
| `required` | boolean | No | Whether field is required. Defaults to `false`. |
| `disabled` | boolean | No | Whether field is disabled. Defaults to `false`. |
| `rows` | integer | No | Number of visible text rows. Defaults to `4`. |
| `maxLength` | integer | No | Maximum character length |
| `validation` | object | No | Validation rules (see section 4) |
| `conditionalValidation` | object | No | Conditional validation rules (see section 4.3) |
| `fallback` | object | No | Fallback block for non-forms viewers (see section 7) |

### 3.3 Checkbox

```json
{
  "type": "forms:checkbox",
  "name": "agree",
  "label": "I agree to the terms and conditions",
  "required": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"forms:checkbox"` |
| `name` | string | Yes | Field name for form data |
| `label` | string | No | Display label |
| `required` | boolean | No | Whether field is required. Defaults to `false`. |
| `disabled` | boolean | No | Whether field is disabled. Defaults to `false`. |
| `defaultChecked` | boolean | No | Initial checked state. Defaults to `false`. |
| `validation` | object | No | Validation rules (see section 4) |
| `conditionalValidation` | object | No | Conditional validation rules (see section 4.3) |
| `fallback` | object | No | Fallback block for non-forms viewers (see section 7) |

### 3.4 Radio Group

```json
{
  "type": "forms:radioGroup",
  "name": "preference",
  "label": "Contact Preference",
  "options": [
    { "value": "email", "label": "Email" },
    { "value": "phone", "label": "Phone" },
    { "value": "mail", "label": "Postal Mail" }
  ],
  "required": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"forms:radioGroup"` |
| `name` | string | Yes | Field name for form data |
| `label` | string | No | Display label |
| `required` | boolean | No | Whether field is required. Defaults to `false`. |
| `disabled` | boolean | No | Whether field is disabled. Defaults to `false`. |
| `options` | array | Yes | Array of option objects (`{ "value": string, "label": string, "disabled"?: boolean }`) |
| `defaultValue` | string | No | Default selected value |
| `validation` | object | No | Validation rules (see section 4) |
| `conditionalValidation` | object | No | Conditional validation rules (see section 4.3) |
| `fallback` | object | No | Fallback block for non-forms viewers (see section 7) |

### 3.5 Dropdown

```json
{
  "type": "forms:dropdown",
  "name": "country",
  "label": "Country",
  "options": [
    { "value": "us", "label": "United States" },
    { "value": "ca", "label": "Canada" },
    { "value": "uk", "label": "United Kingdom" }
  ],
  "searchable": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"forms:dropdown"` |
| `name` | string | Yes | Field name for form data |
| `label` | string | No | Display label |
| `required` | boolean | No | Whether field is required. Defaults to `false`. |
| `disabled` | boolean | No | Whether field is disabled. Defaults to `false`. |
| `options` | array | Yes | Array of option objects (`{ "value": string, "label": string, "disabled"?: boolean }`) |
| `defaultValue` | string | No | Default selected value |
| `searchable` | boolean | No | Enable search/filter functionality. Defaults to `false`. |
| `multiple` | boolean | No | Allow multiple selections. Defaults to `false`. |
| `validation` | object | No | Validation rules (see section 4) |
| `conditionalValidation` | object | No | Conditional validation rules (see section 4.3) |
| `fallback` | object | No | Fallback block for non-forms viewers (see section 7) |

### 3.6 Date Picker

```json
{
  "type": "forms:datePicker",
  "name": "birthDate",
  "label": "Date of Birth",
  "format": "YYYY-MM-DD",
  "minDate": "1900-01-01",
  "maxDate": "today"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"forms:datePicker"` |
| `name` | string | Yes | Field name for form data |
| `label` | string | No | Display label |
| `required` | boolean | No | Whether field is required. Defaults to `false`. |
| `disabled` | boolean | No | Whether field is disabled. Defaults to `false`. |
| `format` | string | No | Date format pattern (e.g., `"YYYY-MM-DD"`). Defaults to `"YYYY-MM-DD"`. |
| `minDate` | string | No | Minimum selectable date (ISO 8601 date string or `"today"`) |
| `maxDate` | string | No | Maximum selectable date (ISO 8601 date string or `"today"`) |
| `includeTime` | boolean | No | Include time selection. Defaults to `false`. |
| `validation` | object | No | Validation rules (see section 4) |
| `conditionalValidation` | object | No | Conditional validation rules (see section 4.3) |
| `fallback` | object | No | Fallback block for non-forms viewers (see section 7) |

The `minDate` and `maxDate` fields accept ISO 8601 date strings (e.g., `"2024-01-01"`). The special value `"today"` is also supported, representing the current date at the time of form rendering. No other relative date keywords are defined.

### 3.7 Signature Field

```json
{
  "type": "forms:signature",
  "name": "signature",
  "label": "Signature",
  "required": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"forms:signature"` |
| `name` | string | Yes | Field name for form data |
| `label` | string | No | Display label |
| `required` | boolean | No | Whether field is required. Defaults to `false`. |
| `disabled` | boolean | No | Whether field is disabled. Defaults to `false`. |
| `width` | integer | No | Signature pad width in pixels (minimum 100) |
| `height` | integer | No | Signature pad height in pixels (minimum 50) |
| `validation` | object | No | Validation rules (see section 4) |
| `conditionalValidation` | object | No | Conditional validation rules (see section 4.3) |
| `fallback` | object | No | Fallback block for non-forms viewers (see section 7) |

The `forms:signature` field captures visual/input signatures (e.g., drawn signatures or typed names) as part of form data. This is distinct from the security extension's cryptographic digital signatures, which provide tamper detection and non-repudiation. For documents requiring both visual and cryptographic signatures, use `forms:signature` for the user-facing input and the security extension for cryptographic verification.

## 4. Validation

### 4.1 Built-in Validators

| Validator | Description |
|-----------|-------------|
| `required` | Field must have a value |
| `minLength` | Minimum string length |
| `maxLength` | Maximum string length |
| `min` | Minimum numeric value |
| `max` | Maximum numeric value |
| `pattern` | Regular expression match |
| `email` | Valid email format |
| `url` | Valid URL format |
| `containsUppercase` | Must contain at least one uppercase letter |
| `containsLowercase` | Must contain at least one lowercase letter |
| `containsDigit` | Must contain at least one digit |
| `containsSpecial` | Must contain at least one special character |
| `matchesField` | Must match the value of another named field |

### 4.2 Declarative Validation

Validation rules are purely declarative. Executable expressions (JavaScript, etc.) are not permitted in validation rules, consistent with the core specification's no-scripting policy (see DD-010, DD-019).

Multiple validators can be combined on a single field:

```json
{
  "type": "forms:textInput",
  "name": "password",
  "label": "Password",
  "required": true,
  "validation": {
    "minLength": 8,
    "containsUppercase": true,
    "containsDigit": true,
    "message": "Password must be at least 8 characters with uppercase and number"
  }
}
```

For complex string matching beyond built-in validators, use the `pattern` validator:

```json
{
  "validation": {
    "pattern": "^(?=.*[A-Z])(?=.*[0-9]).{8,}$",
    "message": "Password must be at least 8 characters with uppercase and number"
  }
}
```

For cross-field validation (e.g., password confirmation):

```json
{
  "type": "forms:textInput",
  "name": "confirmPassword",
  "label": "Confirm Password",
  "validation": {
    "matchesField": "password",
    "message": "Passwords must match"
  }
}
```

### 4.3 Conditional Validation

Apply validation rules based on other field values using `conditionalValidation`:

```json
{
  "type": "forms:textInput",
  "name": "state",
  "label": "State/Province",
  "conditionalValidation": {
    "when": { "field": "country", "equals": "us" },
    "then": { "required": true }
  }
}
```

The `when` condition supports the following operators:

| Operator | Description |
|----------|-------------|
| `equals` | Condition is true when the field equals the specified value |
| `notEquals` | Condition is true when the field does not equal the specified value |
| `isEmpty` | Condition is true when the field is empty (set to `true`) |
| `isNotEmpty` | Condition is true when the field has a value (set to `true`) |

Only one operator should be used per condition. When the condition evaluates to true, all validation rules in `then` are applied to the field.

Example with multiple conditional rules:

```json
{
  "type": "forms:textInput",
  "name": "companyName",
  "label": "Company Name",
  "conditionalValidation": {
    "when": { "field": "employmentType", "equals": "employed" },
    "then": {
      "required": true,
      "minLength": 2,
      "message": "Company name is required for employed individuals"
    }
  }
}
```

## 5. Form Data

### 5.1 Storage

Form values are stored in `forms/data.json`:

```json
{
  "version": "0.1",
  "values": {
    "fullName": "Jane Doe",
    "email": "jane@example.com",
    "country": "us"
  },
  "submitted": false,
  "lastModified": "2025-01-15T10:00:00Z"
}
```

### 5.2 Submission

```json
{
  "form": {
    "action": "https://api.example.com/submit",
    "method": "POST",
    "encoding": "application/json"
  }
}
```

## 6. State Behavior

### 6.1 Form Definition vs. Form Data

Form content has two distinct parts with different hashing and mutability rules:

| Component | Location | Part of Content Hash | Frozen Behavior |
|-----------|----------|---------------------|-----------------|
| Form field blocks (definition) | `content/document.json` | Yes | Immutable — field layout, labels, and validation rules cannot change |
| Form data (filled values) | `forms/data.json` | No | Mutable — forms can be filled even on frozen documents |

### 6.2 Frozen/Published Documents

When a document containing forms is frozen or published:

1. **Form field blocks** are immutable content — they are part of the content hash and cannot be modified
2. **Form data** (`forms/data.json`) is outside the content hash boundary and can continue to be filled, similar to how annotations remain mutable on frozen documents
3. Filling in form data does not change the document ID or invalidate signatures

### 6.3 Form Submission

When a form is submitted (`"submitted": true` in `forms/data.json`):

- The submission state is recorded in the form data file, with the submission time in `submittedAt`
- For archival purposes, implementations MAY create a new document version with form data folded into the content layer, producing a new document ID that captures the filled state

### 6.4 Hashing Exclusion

The `forms/` directory is excluded from the content hash computation, alongside other non-content directories (see Document Hashing specification, section 4.1).

## 7. Fallback Rendering

For viewers that don't support forms:

```json
{
  "type": "forms:textInput",
  "name": "email",
  "label": "Email",
  "fallback": {
    "type": "paragraph",
    "children": [
      { "type": "text", "value": "Email: _________________" }
    ]
  }
}
```

## 8. Examples

### 8.1 Contact Form

```json
{
  "type": "forms:form",
  "id": "contact-form",
  "children": [
    {
      "type": "forms:textInput",
      "name": "name",
      "label": "Name",
      "required": true
    },
    {
      "type": "forms:textInput",
      "name": "email",
      "label": "Email",
      "required": true,
      "validation": { "type": "email" }
    },
    {
      "type": "forms:textArea",
      "name": "message",
      "label": "Message",
      "required": true,
      "rows": 5
    },
    {
      "type": "forms:checkbox",
      "name": "subscribe",
      "label": "Subscribe to newsletter"
    },
    {
      "type": "forms:submit",
      "label": "Send Message"
    }
  ]
}
```
