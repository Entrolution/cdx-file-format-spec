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

Every form block also carries the standard block `id` (and `attributes`) defined by the core content model. A block's `id` is its identifier in the document-wide anchor namespace (so a field can be a cross-reference target); it is distinct from a field's `name`, which is the key under which the field's value is stored in the form data (section 5). The field tables below omit `id` because it is shared by all blocks.

The `placeholder` field is meaningful only for the text-bearing inputs `forms:textInput` and `forms:textArea`. On other field types it has no defined rendering and SHOULD be omitted.

### 3.0a Form Container

The `forms:form` block is a container that groups form fields together and provides submission configuration. Its `children` are content blocks: typically form field blocks and submit buttons, but any content block is permitted — for example, headings or paragraphs that structure the form.

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
| `children` | array | Yes | Array of content blocks (typically form field blocks and submit buttons; any content block is permitted) |

> **Renderer safety.** The form `action` is constrained to safe schemes (Renderer Safety section 2.1): a `javascript:` or `data:` action carried in signed content would otherwise be a signed code-execution primitive, so it is rejected. A field's `validation.pattern` is a client-side convenience, not a trust boundary — the receiving endpoint MUST re-validate every submitted value, and a renderer MUST bound pattern evaluation against catastrophic backtracking (Renderer Safety section 4).

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

The `forms:signature` field captures visual/input signatures (e.g., drawn signatures or typed names) as part of form data. This is distinct from the security extension's cryptographic digital signatures, which provide tamper detection and non-repudiation. For documents requiring both visual and cryptographic signatures, use `forms:signature` for the user-facing input and the security extension for cryptographic verification. The field defines only the capture widget; the captured signature itself is stored in `forms/data.json` (see section 6.5), outside the content hash and bound by no signature, so it is advisory and forgeable and provides no integrity, non-repudiation, or binding on its own.

CDX uses the word "signature" for four distinct, namespaced constructs; do not conflate them:

| Construct | Where it lives | What it is |
|-----------|----------------|------------|
| `forms:signature` (this field) | `forms/data.json` (captured value) | An advisory visual/input signature; no cryptographic meaning |
| core `signature` block | `content/document.json` (in-hash) | A content block that renders a signature image or line in the document body — rendered content, not an attestation |
| `legal:signatureBlock` (legal extension) | `content/document.json` (in-hash) | A legal signature block modeling a signatory and execution details of a legal instrument — in-hash content, not a cryptographic signature |
| security-extension digital signature (`cdx.security`) | `security/signatures.json` | The only cryptographic signature — provides tamper detection and non-repudiation |

Only the last authenticates anything; the first three are rendered or captured representations that a verifier MUST NOT treat as tamper-evident or non-repudiable.

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

Field references — `matchesField` here and `when.field` in section 4.3 — resolve by `name`, scoped to the enclosing `forms:form`. A field's `name` MUST be unique within its `forms:form`; a producer MUST NOT emit two fields sharing a `name` in one form. A reference to a `name` that is absent, or ambiguous because of a collision, is unresolvable: a renderer MUST NOT treat the field as valid on the strength of that rule (it fails closed), and because client-side validation is not a trust boundary the receiving endpoint re-validates every value regardless (section 3.0a).

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

Authoring guidance is to use a single operator per condition. The schema does not enforce this — a `when` object MAY carry more than one operator — so a consumer MUST resolve the multi-operator case deterministically: when a `when` object contains more than one operator, the condition is true only if **every** operator present evaluates true (logical AND). When the condition evaluates to true, all validation rules in `then` are applied to the field.

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

Form values are stored in `forms/data.json`, scoped per form:

```json
{
  "version": "0.1",
  "values": {
    "signup-form": {
      "fullName": "Jane Doe",
      "email": "jane@example.com",
      "country": "us"
    },
    "newsletter-form": {
      "email": "jane.work@example.com"
    }
  },
  "submitted": {
    "signup-form": false,
    "newsletter-form": true
  },
  "submittedAt": {
    "newsletter-form": "2025-01-15T09:58:00Z"
  },
  "lastModified": "2025-01-15T10:00:00Z"
}
```

`values` is keyed by the enclosing `forms:form` block's `id`, and each entry is that form's own field-name → value map. Keying by form id is what keeps a field's `name` scoped to its form (section 4.2): two forms in the same document may each define a field named `email` without colliding, because their values live under different form-id keys rather than in one flat, document-global namespace. A field entered outside any `forms:form` container has no enclosing form id and therefore no place in `values`; every fillable field is authored inside a `forms:form`.

Submission state is likewise per form: `submitted` maps each form's id to whether that form has been submitted, and `submittedAt` maps a submitted form's id to its ISO 8601 submission timestamp, so each form tracks its own submission independently. `version` and `lastModified` describe the data file as a whole and stay at the top level.

The `version` field follows the extension version contract in the CDX Extensions overview (Versioning): a higher minor is processed with unrecognized fields ignored; a higher major — or a reader without forms support — follows the manifest `required` flag; and because `forms/data.json` is outside the document hash, a version mismatch degrades rendering (a WARNING), never an integrity error.

### 5.2 Submission

The submission target is **not** part of the form data layer. A form's `action`, `method`, and `encoding` are properties of the in-hash `forms:form` container block (section 3.0a), stored in `content/document.json` and therefore covered by the content hash. The object below restates those in-hash fields for reference only; `forms/data.json` carries no submission endpoint, and a consumer preparing a submission MUST read `action`/`method`/`encoding` from the `forms:form` block, never from the mutable data file:

```json
{
  "form": {
    "action": "https://api.example.com/submit",
    "method": "POST",
    "encoding": "application/json"
  }
}
```

Because the endpoint lives in signed content, an attacker cannot silently redirect a submission by editing the out-of-hash `forms/data.json`. A renderer MUST also apply the `action` safe-scheme constraint (section 3.0a), and the receiving endpoint MUST re-validate every submitted value.

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

When a form is submitted (its form id set to `true` under `submitted` in `forms/data.json`, e.g. `"submitted": { "signup-form": true }`):

- The submission state is recorded in the form data file per form, with that form's submission time under its id in `submittedAt`
- For archival purposes, implementations MAY create a new document version with form data folded into the content layer, producing a new document ID that captures the filled state

### 6.4 Hashing Exclusion

The `forms/` directory is excluded from the content hash computation, alongside other non-content directories (see Document Hashing specification, section 4.1).

### 6.5 Integrity Status

Form structure and form data sit in different integrity tiers (see the extensions overview, Integrity Status of Extension Data):

| Construct | Location | In document hash | Authenticated |
|-----------|----------|------------------|---------------|
| Field definitions (blocks, labels, validation rules) | `content/document.json` | Yes | Bytes are bound; a `forms:signature` definition is a capture widget, not a cryptographic signature |
| Captured form data | `forms/data.json` | No | No — advisory and forgeable |

Everything a respondent enters is stored in `forms/data.json`: the per-form field entries in the `values` map — including a captured `forms:signature` image and any consent checkbox — and the per-form submission state (`submitted`, `submittedAt`), alongside the file-level `lastModified`. This file is outside the content hash and bound by no signature, so it stays mutable even on a `frozen` or `published` document, and an archive writer can alter or fabricate any of it without changing the document ID or invalidating a signature. The entries named here are examples — *no* value in `forms/data.json` is authenticated.

A verifier or relying party MUST NOT treat a captured value, a captured `forms:signature`, a consent flag, or a `submitted` state as a tamper-evident or non-repudiable record. To bind a respondent's input to the document, fold it into signed content — producing a new document version and ID (section 6.3) — or attest it with a security-extension signature; to authenticate the signer's identity, use the security extension rather than `forms:signature`.

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

> **Reader dispositions.** A consumer without forms support treats a `forms:*` block as an unknown namespaced block (State Machine section 5.4): it renders the block's `fallback` if present, otherwise IGNOREs the field. A structurally malformed forms block of a known type is a WARNING in draft/review and an INTEGRITY-ERROR on a frozen or published document. Form filling and submission stay permitted on a frozen or published document because `forms/data.json` is an out-of-hash layer (State Machine section 3.4); a missing or malformed `forms/data.json` is a WARNING in all states.

> **A `fallback` is a real content block.** The forms schema binds `fallback` to the core content block model (`content.schema.json#/$defs/block`), so a `fallback` is validated as an ordinary content block — the same shape, and the same closure, as the rest of the document body. A `fallback` lives in `content/document.json` and is covered by the content hash. A non-forms consumer that renders a `fallback` still applies the same renderer-safety allowlists it applies to primary content (Renderer Safety section 6) before rendering.

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
      "validation": { "email": true }
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
