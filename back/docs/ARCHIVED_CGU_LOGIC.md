# Archived CGU Logic (Register Page)

Previously, the registration process enforced a strict validation of the Terms and Conditions (CGU).
The user was **required** to click on the CGU link (`onCguLinkClicked`) before being able to check the acceptance checkbox (`hasAcceptedCgu`).

If they tried to submit without having clicked the link, a blocking error would occur (`triggerCguError`).

This behavior has been relaxed:
- The user can now check the box without clicking the link.
- However, the vibration effect (`cguError`) and the helper text (`showCguHelpText`) are preserved if the user attempts to submit without checking the box.
- The `hasViewedCgu` state logic has been removed from the validation condition.

## Relevant Code Snippets (Before Change)

```typescript
  // RegisterComponent.ts

  hasViewedCgu = false;

  onSubmit() {
    // ...
    if (!this.hasAcceptedCgu || !this.hasViewedCgu) { // Requirement of hasViewedCgu
        this.triggerCguError();
        return;
    }
    // ...
  }

  toggleCgu() {
    this.hasAcceptedCgu = !this.hasAcceptedCgu;
    // Logic that might have prevented toggling if not viewed (though in the provided file it just cleared error)
    if (this.hasAcceptedCgu && this.hasViewedCgu) {
      this.cguError = false;
      this.showCguHelpText = false;
    }
  }
```

This ensures we have a record of this strict compliance feature if we ever need to restore it.
