#!/bin/bash

# Aerostack - Quick Start Script
# Adapted from enterprise-lyzr-baseline
# Provides quick access to common development commands

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show menu
show_menu() {
    clear
    echo "Aerostack - Quick Start Menu"
    echo "======================="
    echo ""
    echo "1. Quick Start Guide"
    echo "2. Start Storage Services (Docker)"
    echo "3. Start Backend (Squid)"
    echo "4. Start Frontend (PWA)"
    echo "5. Start All (Storage + Backend + Frontend)"
    echo "6. Setup Local Kubernetes (Minikube)"
    echo "7. Deploy to Local K8s"
    echo "8. Show Status"
    echo "9. Stop Storage Services"
    echo "10. Help & Documentation"
    echo "11. Exit"
    echo ""
    read -p "Select an option (1-11): " choice
}

# Function to quick start
quick_start() {
    print_status "Aerostack Quick Start Guide"
    echo ""
    echo "Daily Development Workflow:"
    echo "==========================="
    echo ""
    echo "Terminal 1: Start storage"
    echo "  $ make start-storage"
    echo ""
    echo "Terminal 2: Start backend"
    echo "  $ cd squid-backend && pnpm dev"
    echo ""
    echo "Terminal 3: Start frontend"
    echo "  $ cd pwa-frontend && pnpm dev"
    echo ""
    echo "Access:"
    echo "  Frontend: http://localhost:5173"
    echo "  Backend:  http://localhost:8000"
    echo ""
    echo "Or use: make dev (starts all with turbo)"
    echo ""
    read -p "Press Enter to continue..."
}

# Function to start storage
start_storage() {
    print_status "Starting storage services..."
    make start-storage
    print_success "Storage services started"
    read -p "Press Enter to continue..."
}

# Function to start backend
start_backend() {
    print_status "Starting Squid backend..."
    print_warning "This will open in a new terminal. Press Ctrl+C to stop."
    echo ""
    echo "Run this in a new terminal:"
    echo "  cd squid-backend && pnpm dev"
    echo ""
    read -p "Press Enter to continue..."
}

# Function to start frontend
start_frontend() {
    print_status "Starting PWA frontend..."
    print_warning "This will open in a new terminal. Press Ctrl+C to stop."
    echo ""
    echo "Run this in a new terminal:"
    echo "  cd pwa-frontend && pnpm dev"
    echo ""
    read -p "Press Enter to continue..."
}

# Function to start all
start_all() {
    print_status "Starting all services..."
    print_warning "Starting storage services in background..."
    make start-storage
    echo ""
    print_status "To start backend and frontend:"
    echo "  Terminal 1: cd squid-backend && pnpm dev"
    echo "  Terminal 2: cd pwa-frontend && pnpm dev"
    echo ""
    echo "Or run: make dev"
    echo ""
    read -p "Press Enter to continue..."
}

# Function to setup minikube
setup_minikube() {
    print_status "Setting up minikube..."
    make setup-minikube
    print_success "Minikube setup complete"
    read -p "Press Enter to continue..."
}

# Function to deploy to local k8s
deploy_local() {
    print_status "Deploying to local Kubernetes..."
    make deploy-local-k8s
    print_success "Deployment complete"
    read -p "Press Enter to continue..."
}

# Function to show status
show_status() {
    clear
    print_status "Aerostack System Status"
    echo ""
    
    # Check Docker
    if docker info >/dev/null 2>&1; then
        print_success "Docker is running"
        echo ""
        echo "Storage Services:"
        docker-compose ps 2>/dev/null || echo "  No services running"
    else
        print_error "Docker is not running"
    fi
    
    echo ""
    
    # Check Node
    if command -v node >/dev/null 2>&1; then
        NODE_VERSION=$(node -v)
        print_success "Node.js $NODE_VERSION"
    else
        print_error "Node.js not found"
    fi
    
    echo ""
    
    # Check Kubernetes
    if command -v minikube >/dev/null 2>&1; then
        if minikube status >/dev/null 2>&1; then
            print_success "Minikube is running"
            echo ""
            make k8s-status 2>/dev/null || true
        else
            print_warning "Minikube is installed but not running"
        fi
    else
        print_warning "Minikube not installed"
    fi
    
    echo ""
    read -p "Press Enter to continue..."
}

# Function to stop storage
stop_storage() {
    print_status "Stopping storage services..."
    make stop-storage
    print_success "Storage services stopped"
    read -p "Press Enter to continue..."
}

# Function to show help
show_help() {
    clear
    echo "Aerostack - Help & Documentation"
    echo "============================"
    echo ""
    echo "Available Commands:"
    echo "=================="
    echo ""
    echo "make help                    - Show all available commands"
    echo "make help-dev               - Development workflow help"
    echo "make help-deploy            - Deployment commands help"
    echo ""
    echo "Storage Commands:"
    echo "================="
    echo "make start-storage          - Start MongoDB, Redis"
    echo "make stop-storage           - Stop storage services"
    echo "make storage-status         - Check storage status"
    echo "make storage-logs           - View storage logs"
    echo ""
    echo "Development Commands:"
    echo "====================="
    echo "make run-backend            - Start Squid backend"
    echo "make run-frontend           - Start PWA frontend"
    echo "make dev                    - Start all (turbo)"
    echo "make test-all               - Run all tests"
    echo ""
    echo "Kubernetes Commands:"
    echo "===================="
    echo "make setup-minikube         - Setup local K8s"
    echo "make deploy-local-k8s       - Deploy to local K8s"
    echo "make k8s-status             - Check K8s status"
    echo "make k8s-cleanup            - Clean up K8s"
    echo ""
    echo "Documentation:"
    echo "=============="
    echo "README.md                   - Project overview"
    echo "START-HERE.md               - Getting started"
    echo "docs/                       - Full documentation"
    echo ""
    read -p "Press Enter to continue..."
}

# Main menu loop
while true; do
    show_menu
    
    case $choice in
        1)
            quick_start
            ;;
        2)
            start_storage
            ;;
        3)
            start_backend
            ;;
        4)
            start_frontend
            ;;
        5)
            start_all
            ;;
        6)
            setup_minikube
            ;;
        7)
            deploy_local
            ;;
        8)
            show_status
            ;;
        9)
            stop_storage
            ;;
        10)
            show_help
            ;;
        11)
            print_success "Exiting..."
            exit 0
            ;;
        *)
            print_error "Invalid option. Please select 1-11."
            sleep 2
            ;;
    esac
done

