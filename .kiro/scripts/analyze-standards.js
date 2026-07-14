#!/usr/bin/env node

/**
 * enterprise Standards Analysis Script
 * 
 * Analyzes a codebase against enterprise development standards and generates
 * a comprehensive compliance report with actionable recommendations.
 * 
 * Usage:
 *   node .kiro/scripts/analyze-standards.js [options]
 * 
 * Options:
 *   --output <file>    Write report to file (default: stdout)
 *   --format <type>    Output format: markdown, json, html (default: markdown)
 *   --category <name>  Analyze specific category only
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Analysis categories
const CATEGORIES = {
  ARCHITECTURE: 'Architecture & Stack',
  SECURITY: 'Security',
  TESTING: 'Testing',
  GRC: 'GRC Compliance',
  CODE_QUALITY: 'Code Quality',
  INFRASTRUCTURE: 'Infrastructure',
  GIT: 'Git & Version Control',
};

// Severity levels
const SEVERITY = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  INFO: 'INFO',
};

class StandardsAnalyzer {
  constructor() {
    this.findings = [];
    this.stats = {
      total: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
  }

  addFinding(category, severity, title, description, recommendation, files = []) {
    this.findings.push({
      category,
      severity,
      title,
      description,
      recommendation,
      files,
    });
    this.stats.total++;
    this.stats[severity.toLowerCase()]++;
  }

  // Check if file exists
  fileExists(filePath) {
    return fs.existsSync(path.join(process.cwd(), filePath));
  }

  // Read file content
  readFile(filePath) {
    try {
      return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
    } catch (error) {
      return null;
    }
  }

  // Search for pattern in files
  searchPattern(pattern, fileGlob) {
    try {
      const result = execSync(
        `grep -r "${pattern}" ${fileGlob} 2>/dev/null || true`,
        { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
      );
      return result.trim().split('\n').filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  // Count files matching pattern
  countFiles(pattern) {
    try {
      const result = execSync(
        `find . -type f -name "${pattern}" 2>/dev/null | wc -l`,
        { encoding: 'utf8' }
      );
      return parseInt(result.trim(), 10);
    } catch (error) {
      return 0;
    }
  }

  // Analyze architecture and stack decisions
  analyzeArchitecture() {
    console.log('Analyzing architecture...');

    const packageJson = this.readFile('package.json');
    if (!packageJson) {
      this.addFinding(
        CATEGORIES.ARCHITECTURE,
        SEVERITY.CRITICAL,
        'Missing package.json',
        'No package.json found in project root',
        'Create package.json with project dependencies'
      );
      return;
    }

    const pkg = JSON.parse(packageJson);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    // Check for Next.js
    if (!deps['next']) {
      this.addFinding(
        CATEGORIES.ARCHITECTURE,
        SEVERITY.HIGH,
        'Next.js not detected',
        'enterprise standard is Next.js 14+ with App Router',
        'Consider migrating to Next.js or document exception',
        ['package.json']
      );
    }

    // Check for React
    if (!deps['react']) {
      this.addFinding(
        CATEGORIES.ARCHITECTURE,
        SEVERITY.INFO,
        'React not detected',
        'Project does not use React',
        'If this is a frontend project, consider React as per standards',
        ['package.json']
      );
    }

    // Check for TypeScript
    if (!deps['typescript'] && !this.fileExists('tsconfig.json')) {
      this.addFinding(
        CATEGORIES.ARCHITECTURE,
        SEVERITY.MEDIUM,
        'TypeScript not configured',
        'enterprise standard requires TypeScript with strict mode',
        'Add TypeScript to project with strict configuration',
        ['package.json']
      );
    }

    // Check for state management
    if (deps['react'] && !deps['zustand'] && !deps['@tanstack/react-query']) {
      this.addFinding(
        CATEGORIES.ARCHITECTURE,
        SEVERITY.MEDIUM,
        'Standard state management not detected',
        'enterprise uses Zustand for client state and TanStack Query for server state',
        'Add Zustand and TanStack Query for state management',
        ['package.json']
      );
    }

    // Check for component library
    if (deps['react'] && !deps['@radix-ui/react-dialog']) {
      this.addFinding(
        CATEGORIES.ARCHITECTURE,
        SEVERITY.LOW,
        'shadcn/ui not detected',
        'enterprise standard is shadcn/ui + Radix UI for components',
        'Consider using shadcn/ui for accessible components',
        ['package.json']
      );
    }
  }

  // Analyze security practices
  analyzeSecurity() {
    console.log('Analyzing security...');

    // Check for .env in git
    const gitignore = this.readFile('.gitignore');
    if (!gitignore || !gitignore.includes('.env')) {
      this.addFinding(
        CATEGORIES.SECURITY,
        SEVERITY.CRITICAL,
        '.env not in .gitignore',
        'Environment files may be committed to version control',
        'Add .env* to .gitignore immediately',
        ['.gitignore']
      );
    }

    // Check for hardcoded secrets
    const secretPatterns = [
      'sk_live_',
      'sk_test_',
      'AKIA',
      'password.*=.*["\']',
      'api_key.*=.*["\']',
    ];

    secretPatterns.forEach((pattern) => {
      const matches = this.searchPattern(pattern, 'src/**/*.{js,ts,jsx,tsx}');
      if (matches.length > 0) {
        this.addFinding(
          CATEGORIES.SECURITY,
          SEVERITY.CRITICAL,
          'Potential hardcoded secrets detected',
          `Found ${matches.length} potential secret(s) in code`,
          'Move all secrets to environment variables or AWS Secrets Manager',
          matches.slice(0, 5)
        );
      }
    });

    // Check for Auth.js / NextAuth
    const packageJson = this.readFile('package.json');
    if (packageJson) {
      const pkg = JSON.parse(packageJson);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      if (deps['react'] && !deps['next-auth']) {
        this.addFinding(
          CATEGORIES.SECURITY,
          SEVERITY.MEDIUM,
          'Auth.js (NextAuth) not detected',
          'enterprise standard for authentication is Auth.js with server-side sessions',
          'Implement Auth.js for authentication',
          ['package.json']
        );
      }
    }

    // Check for input validation
    const packageJson2 = this.readFile('package.json');
    if (packageJson2) {
      const pkg = JSON.parse(packageJson2);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      if (!deps['zod']) {
        this.addFinding(
          CATEGORIES.SECURITY,
          SEVERITY.MEDIUM,
          'Zod validation not detected',
          'enterprise standard requires Zod for runtime validation',
          'Add Zod for input validation and schema validation',
          ['package.json']
        );
      }
    }
  }

  // Analyze testing setup
  analyzeTesting() {
    console.log('Analyzing testing...');

    const packageJson = this.readFile('package.json');
    if (!packageJson) return;

    const pkg = JSON.parse(packageJson);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    // Check for Vitest
    if (!deps['vitest']) {
      this.addFinding(
        CATEGORIES.TESTING,
        SEVERITY.MEDIUM,
        'Vitest not detected',
        'enterprise standard test runner is Vitest',
        'Migrate to Vitest from Jest or add Vitest',
        ['package.json']
      );
    }

    // Check for React Testing Library
    if (deps['react'] && !deps['@testing-library/react']) {
      this.addFinding(
        CATEGORIES.TESTING,
        SEVERITY.MEDIUM,
        'React Testing Library not detected',
        'enterprise standard for component testing is React Testing Library',
        'Add @testing-library/react for component tests',
        ['package.json']
      );
    }

    // Check for Playwright
    if (!deps['@playwright/test']) {
      this.addFinding(
        CATEGORIES.TESTING,
        SEVERITY.LOW,
        'Playwright not detected',
        'enterprise standard for e2e testing is Playwright',
        'Add Playwright for end-to-end tests',
        ['package.json']
      );
    }

    // Check for test files
    const testCount = this.countFiles('*.test.{js,ts,jsx,tsx}');
    const specCount = this.countFiles('*.spec.{js,ts,jsx,tsx}');
    
    if (testCount + specCount === 0) {
      this.addFinding(
        CATEGORIES.TESTING,
        SEVERITY.HIGH,
        'No test files found',
        'No test files detected in project',
        'Add unit and integration tests following testing standards',
        []
      );
    }

    // Check for test coverage configuration
    if (!this.fileExists('vitest.config.ts') && !this.fileExists('vitest.config.js')) {
      if (deps['vitest']) {
        this.addFinding(
          CATEGORIES.TESTING,
          SEVERITY.LOW,
          'Vitest configuration missing',
          'No vitest.config file found',
          'Create vitest.config.ts with coverage thresholds (80% lines, 80% functions)',
          []
        );
      }
    }
  }

  // Analyze GRC compliance
  analyzeGRC() {
    console.log('Analyzing GRC compliance...');

    // Check for PII in localStorage
    const localStorageUsage = this.searchPattern('localStorage.setItem', 'src/**/*.{js,ts,jsx,tsx}');
    if (localStorageUsage.length > 0) {
      this.addFinding(
        CATEGORIES.GRC,
        SEVERITY.HIGH,
        'localStorage usage detected',
        'PII must never be stored in client-side storage',
        'Review localStorage usage and ensure no PII is stored. Use server-side sessions.',
        localStorageUsage.slice(0, 5)
      );
    }

    // Check for audit logging
    const auditLogExists = this.fileExists('src/lib/audit-log.ts') || 
                          this.fileExists('src/utils/audit-log.ts') ||
                          this.fileExists('lib/audit-log.ts');
    
    if (!auditLogExists) {
      this.addFinding(
        CATEGORIES.GRC,
        SEVERITY.MEDIUM,
        'Audit logging not implemented',
        'No audit logging system detected',
        'Implement audit logging for all sensitive actions (auth, data access, modifications)',
        []
      );
    }

    // Check for data classification
    const dataClassificationUsage = this.searchPattern('@dataClassification', 'src/**/*.{js,ts,jsx,tsx}');
    if (dataClassificationUsage.length === 0) {
      this.addFinding(
        CATEGORIES.GRC,
        SEVERITY.LOW,
        'Data classification not used',
        'Components should declare data sensitivity levels',
        'Add @dataClassification JSDoc tags to components handling sensitive data',
        []
      );
    }

    // Check for accessibility
    const ariaUsage = this.searchPattern('aria-', 'src/**/*.{js,ts,jsx,tsx}');
    if (ariaUsage.length === 0) {
      this.addFinding(
        CATEGORIES.GRC,
        SEVERITY.MEDIUM,
        'Limited accessibility attributes',
        'Few or no ARIA attributes found in components',
        'Add proper ARIA labels, roles, and attributes for WCAG 2.1 AA compliance',
        []
      );
    }
  }

  // Analyze code quality
  analyzeCodeQuality() {
    console.log('Analyzing code quality...');

    // Check for ESLint
    if (!this.fileExists('.eslintrc.js') && 
        !this.fileExists('.eslintrc.json') && 
        !this.fileExists('eslint.config.js')) {
      this.addFinding(
        CATEGORIES.CODE_QUALITY,
        SEVERITY.MEDIUM,
        'ESLint not configured',
        'No ESLint configuration found',
        'Add ESLint with recommended rules',
        []
      );
    }

    // Check for Prettier
    if (!this.fileExists('.prettierrc') && 
        !this.fileExists('.prettierrc.json') && 
        !this.fileExists('prettier.config.js')) {
      this.addFinding(
        CATEGORIES.CODE_QUALITY,
        SEVERITY.LOW,
        'Prettier not configured',
        'No Prettier configuration found',
        'Add Prettier for consistent code formatting',
        []
      );
    }

    // Check for TypeScript strict mode
    const tsconfig = this.readFile('tsconfig.json');
    if (tsconfig) {
      const config = JSON.parse(tsconfig);
      if (!config.compilerOptions?.strict) {
        this.addFinding(
          CATEGORIES.CODE_QUALITY,
          SEVERITY.MEDIUM,
          'TypeScript strict mode not enabled',
          'tsconfig.json does not have strict: true',
          'Enable strict mode in tsconfig.json',
          ['tsconfig.json']
        );
      }
    }
  }

  // Analyze infrastructure
  analyzeInfrastructure() {
    console.log('Analyzing infrastructure...');

    const hasCDK = this.fileExists('cdk.json') || this.countFiles('*-stack.ts') > 0;
    const hasTerraform = this.countFiles('*.tf') > 0;
    const hasServerless = this.fileExists('serverless.yml');

    if (!hasCDK && !hasTerraform && !hasServerless) {
      this.addFinding(
        CATEGORIES.INFRASTRUCTURE,
        SEVERITY.INFO,
        'No IaC detected',
        'No Infrastructure as Code configuration found',
        'Consider using AWS CDK (enterprise standard) for infrastructure',
        []
      );
    }

    if (hasCDK) {
      // Check for CDK tests
      const cdkTestCount = this.countFiles('*.test.ts');
      if (cdkTestCount === 0) {
        this.addFinding(
          CATEGORIES.INFRASTRUCTURE,
          SEVERITY.MEDIUM,
          'CDK tests missing',
          'No CDK infrastructure tests found',
          'Add tests for CDK stacks using aws-cdk-lib/assertions',
          []
        );
      }
    }

    if (hasServerless) {
      const serverlessYml = this.readFile('serverless.yml');
      if (serverlessYml && !serverlessYml.includes('tags:')) {
        this.addFinding(
          CATEGORIES.INFRASTRUCTURE,
          SEVERITY.LOW,
          'Resource tagging not configured',
          'Serverless resources should be tagged',
          'Add tags to serverless.yml for cost tracking and organization',
          ['serverless.yml']
        );
      }
    }
  }

  // Analyze Git practices
  analyzeGit() {
    console.log('Analyzing Git practices...');

    // Check for conventional commits
    try {
      const recentCommits = execSync('git log --oneline -10 2>/dev/null', { encoding: 'utf8' });
      const commits = recentCommits.split('\n').filter(Boolean);
      
      const conventionalPattern = /^[a-f0-9]+ (feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?:/;
      const nonConventional = commits.filter(c => !conventionalPattern.test(c));
      
      if (nonConventional.length > commits.length / 2) {
        this.addFinding(
          CATEGORIES.GIT,
          SEVERITY.LOW,
          'Conventional commits not followed',
          `${nonConventional.length}/${commits.length} recent commits don't follow conventional format`,
          'Use conventional commit format: type(scope): subject',
          nonConventional.slice(0, 3)
        );
      }
    } catch (error) {
      // Not a git repo or no commits
    }

    // Check for .gitignore
    if (!this.fileExists('.gitignore')) {
      this.addFinding(
        CATEGORIES.GIT,
        SEVERITY.HIGH,
        '.gitignore missing',
        'No .gitignore file found',
        'Create .gitignore to exclude node_modules, .env, build artifacts',
        []
      );
    }
  }

  // Run all analyses
  analyze() {
    console.log('Starting enterprise standards analysis...\n');

    this.analyzeArchitecture();
    this.analyzeSecurity();
    this.analyzeTesting();
    this.analyzeGRC();
    this.analyzeCodeQuality();
    this.analyzeInfrastructure();
    this.analyzeGit();

    console.log('\nAnalysis complete!\n');
  }

  // Generate markdown report
  generateMarkdownReport() {
    let report = '# enterprise Standards Compliance Report\n\n';
    report += `Generated: ${new Date().toISOString()}\n\n`;

    // Summary
    report += '## Summary\n\n';
    report += `- **Total Findings**: ${this.stats.total}\n`;
    report += `- **Critical**: ${this.stats.critical}\n`;
    report += `- **High**: ${this.stats.high}\n`;
    report += `- **Medium**: ${this.stats.medium}\n`;
    report += `- **Low**: ${this.stats.low}\n`;
    report += `- **Info**: ${this.stats.info}\n\n`;

    // Findings by category
    Object.values(CATEGORIES).forEach((category) => {
      const categoryFindings = this.findings.filter(f => f.category === category);
      if (categoryFindings.length === 0) return;

      report += `## ${category}\n\n`;

      categoryFindings.forEach((finding, index) => {
        report += `### ${index + 1}. ${finding.title} [${finding.severity}]\n\n`;
        report += `**Description**: ${finding.description}\n\n`;
        report += `**Recommendation**: ${finding.recommendation}\n\n`;
        
        if (finding.files.length > 0) {
          report += `**Affected Files**:\n`;
          finding.files.forEach(file => {
            report += `- \`${file}\`\n`;
          });
          report += '\n';
        }
      });
    });

    // Next steps
    report += '## Next Steps\n\n';
    report += '1. Address all CRITICAL findings immediately\n';
    report += '2. Plan remediation for HIGH severity findings\n';
    report += '3. Schedule MEDIUM and LOW findings for upcoming sprints\n';
    report += '4. Review INFO findings for potential improvements\n\n';

    report += '---\n\n';
    report += '*Generated by enterprise Standards Analyzer*\n';

    return report;
  }

  // Generate JSON report
  generateJSONReport() {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      stats: this.stats,
      findings: this.findings,
    }, null, 2);
  }
}

// Main execution
function main() {
  const args = process.argv.slice(2);
  const outputFile = args.includes('--output') ? args[args.indexOf('--output') + 1] : null;
  const format = args.includes('--format') ? args[args.indexOf('--format') + 1] : 'markdown';

  const analyzer = new StandardsAnalyzer();
  analyzer.analyze();

  let report;
  if (format === 'json') {
    report = analyzer.generateJSONReport();
  } else {
    report = analyzer.generateMarkdownReport();
  }

  if (outputFile) {
    fs.writeFileSync(outputFile, report);
    console.log(`Report written to ${outputFile}`);
  } else {
    console.log(report);
  }
}

if (require.main === module) {
  main();
}

module.exports = { StandardsAnalyzer };
