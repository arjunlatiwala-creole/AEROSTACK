# enterprise Standards Analysis Scripts

This directory contains scripts for analyzing codebases against enterprise development standards.

## analyze-standards.js

Comprehensive standards compliance analyzer that checks your codebase against all enterprise standards.

### Usage

```bash
# Run analysis and output to console
node .kiro/scripts/analyze-standards.js

# Save report to file
node .kiro/scripts/analyze-standards.js --output STANDARDS_REPORT.md

# Generate JSON report
node .kiro/scripts/analyze-standards.js --format json --output report.json
```

### What It Checks

#### Architecture & Stack
- Next.js 14+ with App Router
- React usage
- TypeScript configuration
- State management (Zustand, TanStack Query)
- Component library (shadcn/ui + Radix UI)

#### Security
- .env in .gitignore
- Hardcoded secrets detection
- Auth.js (NextAuth) implementation
- Zod validation for input

#### Testing
- Vitest configuration
- React Testing Library
- Playwright for e2e
- Test coverage thresholds
- Test file existence

#### GRC Compliance
- localStorage usage (PII concerns)
- Audit logging implementation
- Data classification tags
- Accessibility (ARIA attributes)

#### Code Quality
- ESLint configuration
- Prettier configuration
- TypeScript strict mode

#### Infrastructure
- IaC detection (CDK, Terraform, Serverless)
- Infrastructure tests
- Resource tagging

#### Git & Version Control
- Conventional commits
- .gitignore presence

### Output Format

The script generates a detailed report with:
- Summary statistics (total findings by severity)
- Findings organized by category
- Severity levels: CRITICAL, HIGH, MEDIUM, LOW, INFO
- Specific recommendations for each finding
- Affected files list

### Example Output

```markdown
# enterprise Standards Compliance Report

Generated: 2026-02-21T...

## Summary

- **Total Findings**: 12
- **Critical**: 1
- **High**: 2
- **Medium**: 5
- **Low**: 3
- **Info**: 1

## Security

### 1. .env not in .gitignore [CRITICAL]

**Description**: Environment files may be committed to version control

**Recommendation**: Add .env* to .gitignore immediately

**Affected Files**:
- `.gitignore`

...
```

### Integration with CI/CD

Add to your GitHub Actions workflow:

```yaml
- name: Run Standards Analysis
  run: node .kiro/scripts/analyze-standards.js --output standards-report.md

- name: Upload Report
  uses: actions/upload-artifact@v3
  with:
    name: standards-report
    path: standards-report.md
```

### Customization

To add custom checks, extend the `StandardsAnalyzer` class:

```javascript
const { StandardsAnalyzer } = require('./.kiro/scripts/analyze-standards.js');

class CustomAnalyzer extends StandardsAnalyzer {
  analyzeCustom() {
    // Your custom checks here
    this.addFinding(
      'Custom Category',
      'HIGH',
      'Custom Check Failed',
      'Description',
      'Recommendation',
      ['file.js']
    );
  }

  analyze() {
    super.analyze();
    this.analyzeCustom();
  }
}
```

## Using in Template Repositories

To use this in a template repository:

1. Copy the entire `.kiro` directory to your template
2. Update `.kiro/steering/product.md` with project-specific info
3. Update `.kiro/steering/tech.md` with project-specific tech stack
4. Run the analyzer on new projects created from the template

```bash
# In new project
node .kiro/scripts/analyze-standards.js --output COMPLIANCE_REPORT.md
```

This gives you an instant compliance assessment for any new project.
