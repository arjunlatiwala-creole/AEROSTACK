#!/bin/bash

# enterprise Standards Template Setup Script
# 
# This script helps you customize the template for your new project

set -e

echo "═══════════════════════════════════════════════════════"
echo "  enterprise Standards Template Setup"
echo "═══════════════════════════════════════════════════════"
echo ""

# Check if we're in a git repository
if [ ! -d ".git" ]; then
    echo "❌ Error: Not in a git repository"
    echo "   Please run this from the root of your project"
    exit 1
fi

# Check if .kiro directory exists
if [ ! -d ".kiro" ]; then
    echo "❌ Error: .kiro directory not found"
    echo "   Please ensure the template is properly copied"
    exit 1
fi

echo "This script will help you customize the template for your project."
echo ""

# Get project information
read -p "Project name: " PROJECT_NAME
read -p "Project description: " PROJECT_DESC
read -p "Primary technology (e.g., Next.js, Python/FastAPI, Node.js): " PRIMARY_TECH
read -p "Cloud provider (AWS, GCP, Azure): " CLOUD_PROVIDER
read -p "Your name/team: " TEAM_NAME

echo ""
echo "Customizing template..."

# Update product.md
cat > .kiro/steering/product.md << EOF
---
title: Product Overview
inclusion: always
---

# Product Overview

${PROJECT_DESC}

## Core Features

- [Feature 1]
- [Feature 2]
- [Feature 3]

## Current State

[Describe current deployment and status]

## Target State

[Describe target architecture and goals]

## User Personas

1. [Persona 1] - [Description]
2. [Persona 2] - [Description]
3. [Persona 3] - [Description]
EOF

# Update README.md
cat > README.md << EOF
# ${PROJECT_NAME}

${PROJECT_DESC}

## Technology Stack

- **Primary**: ${PRIMARY_TECH}
- **Cloud**: ${CLOUD_PROVIDER}

## Getting Started

[Add your getting started instructions]

## Development Standards

This project follows enterprise development standards. See \`.kiro/README.md\` for details.

### Run Standards Analysis

\`\`\`bash
node .kiro/scripts/analyze-standards.js --output COMPLIANCE_REPORT.md
\`\`\`

## Team

Maintained by ${TEAM_NAME}

---

*Built with enterprise standards*
EOF

echo "✅ Template customized!"
echo ""
echo "Next steps:"
echo "1. Edit .kiro/steering/tech.md with your specific tech stack"
echo "2. Edit .kiro/steering/structure.md with your project structure"
echo "3. Run: node .kiro/scripts/analyze-standards.js"
echo "4. Start building!"
echo ""
echo "═══════════════════════════════════════════════════════"
