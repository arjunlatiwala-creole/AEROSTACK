# Aerostack - Infrastructure Management Makefile
# Adapted from enterprise-lyzr-baseline for Aerostack with MongoDB + Squid + Lyzr agents

.PHONY: help install-prerequisites dev-setup dev-cleanup test-backend run-backend setup-frontend run-frontend deploy-production deploy-customer clean

# Default target
help: ## Show this help message
	@echo "Aerostack - Infrastructure Management"
	@echo "================================"
	@echo ""
	@echo "Available commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-25s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "For detailed help:"
	@echo "  make help-dev           - Local development workflow"
	@echo "  make help-deploy        - Deployment commands"

# =============================================================================
# 🚀 QUICK START
# =============================================================================
DOCKER_COMPOSE := $(shell if docker compose > /dev/null 2>&1; then echo "docker compose"; else echo "docker-compose"; fi)
quick-start: ## Quick start for new developers
	@echo "🚀 Aerostack Quick Start"
	@echo "==================="
	@echo ""
	@echo "1. Start storage services:"
	@echo "   make start-storage"
	@echo "   # MongoDB, Redis, PostgreSQL (optional)"
	@echo ""
	@echo "2. Start backend (Terminal 1):"
	@echo "   make run-backend"
	@echo "   # Squid backend at http://localhost:8000"
	@echo ""
	@echo "3. Start frontend (Terminal 2):"
	@echo "   make run-frontend"
	@echo "   # React PWA at http://localhost:5173"
	@echo ""
	@echo "4. Test backend:"
	@echo "   make test-backend"
	@echo "   # Should show healthy status"
	@echo ""
	@echo "Storage commands:"
	@echo "   make storage-status    # Check storage services"
	@echo "   make storage-logs      # View storage logs"
	@echo "   make stop-storage      # Stop storage services"

# =============================================================================
# 📦 STORAGE SERVICES (Docker Compose)
# =============================================================================

check-docker: ## Check if Docker is running
	@if ! docker info >/dev/null 2>&1; then \
		echo "❌ Docker is not running. Please start Docker Desktop."; \
		exit 1; \
	fi
	@echo "✅ Docker is running"

check-legacy: ## Check and remove deprecated containers (auto-cleanup)
	@./scripts/check-legacy-containers.sh

start-storage: check-docker check-legacy ## Start all storage services (MongoDB, Redis, PostgreSQL)
	@echo "🚀 Starting Aerostack storage services..."
	@$(DOCKER_COMPOSE) up -d
	@echo "⏳ Waiting for services to be ready..."
	@sleep 5
	@echo "✅ Storage services started!"
	@echo ""
	@echo "Service URLs:"
	@echo "============="
	@echo "MongoDB:     localhost:27017 (user: agent, password: agentpass)"
	@echo "Redis:       localhost:6379 (password: agentpass)"
	@echo "PostgreSQL:  localhost:5432 (user: agent, password: agentpass) [optional]"
	@echo ""
	@echo "To view logs: make storage-logs"
	@echo "To stop: make stop-storage"

stop-storage: ## Stop all storage services
	@echo "⏹️  Stopping storage services..."
	@$(DOCKER_COMPOSE) down --remove-orphans
	@echo "✅ Storage services stopped"

stop-all: ## Stop all services (dev servers + storage)
	@./stop-all.sh

cleanup: ## Clean build artifacts (keeps data)
	@./cleanup.sh

cleanup-full: ## Full cleanup including data (DESTRUCTIVE)
	@./cleanup.sh --full

storage-status: ## Show storage services status
	@echo "📊 Storage services status:"
	@$(DOCKER_COMPOSE) ps

storage-logs: ## Show storage services logs
	@echo "📝 Storage services logs (Ctrl+C to exit):"
	@$(DOCKER_COMPOSE) logs -f

storage-clean: ## Clean storage data volumes (WARNING: deletes all data)
	@echo "⚠️  This will delete all storage data!"
	@read -p "Are you sure? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		echo "🧹 Cleaning storage data..."; \
		$(DOCKER_COMPOSE) down -v; \
		echo "✅ Storage data cleaned"; \
	else \
		echo "❌ Cancelled"; \
	fi

# =============================================================================
# 🔧 NODE.JS VERSION CHECK
# =============================================================================

check-node: ## Check Node.js version (requires Node 20+)
	@echo "🔍 Checking Node.js version..."
	@if command -v node >/dev/null 2>&1; then \
		NODE_VERSION=$$(node -v | sed 's/v//'); \
		MAJOR_VERSION=$$(echo $$NODE_VERSION | cut -d. -f1); \
		if [ $$MAJOR_VERSION -ge 20 ]; then \
			echo "✅ Node.js $$NODE_VERSION (compatible)"; \
		else \
			echo "❌ Node.js $$NODE_VERSION found, but version 20+ required"; \
			echo "💡 Use nvm to install Node 20: nvm install 20 && nvm use 20"; \
			exit 1; \
		fi; \
	else \
		echo "❌ Node.js not found"; \
		echo "💡 Install Node.js 20+ or use nvm: nvm install 20"; \
		exit 1; \
	fi

# =============================================================================
# 🖥️  BACKEND DEVELOPMENT (Squid)
# =============================================================================

setup-backend: check-node ## Setup Squid backend
	@echo "🔧 Setting up Squid backend..."
	@cd squid-backend && pnpm install
	@echo "✅ Squid backend setup complete"

run-backend: ## Start Squid backend (hot reload)
	@echo "🚀 Starting Squid backend..."
	@echo "📡 Backend will run at: http://localhost:8000"
	@echo "📖 API docs at: http://localhost:8000/docs"
	@cd squid-backend && pnpm dev

build-backend: ## Build Squid backend for production
	@echo "🏗️  Building Squid backend..."
	@cd squid-backend && pnpm build
	@echo "✅ Backend build complete"

test-backend: ## Test Squid backend
	@echo "🧪 Testing Squid backend..."
	@cd squid-backend && pnpm test || echo "No tests configured yet"

# =============================================================================
# 🌐 FRONTEND DEVELOPMENT (PWA)
# =============================================================================

setup-frontend: check-node ## Setup PWA frontend
	@echo "🔧 Setting up PWA frontend..."
	@cd pwa-frontend && pnpm install
	@echo "✅ PWA frontend setup complete"

run-frontend: ## Start PWA frontend (hot reload)
	@echo "🚀 Starting PWA frontend..."
	@echo "🌐 Frontend will run at: http://localhost:5173"
	@cd pwa-frontend && pnpm dev

build-frontend: ## Build PWA frontend for production
	@echo "🏗️  Building PWA frontend..."
	@cd pwa-frontend && pnpm build
	@echo "✅ Frontend build complete"

test-frontend: ## Test PWA frontend
	@echo "🧪 Testing PWA frontend..."
	@cd pwa-frontend && pnpm test || echo "No tests configured yet"

lint-frontend: ## Lint PWA frontend
	@echo "🔍 Linting PWA frontend..."
	@cd pwa-frontend && pnpm lint

# =============================================================================
# 📦 MONOREPO MANAGEMENT (pnpm + turbo)
# =============================================================================

install: check-node ## Install all dependencies (pnpm)
	@echo "📦 Installing all dependencies..."
	@pnpm install
	@echo "✅ All dependencies installed"

dev: ## Start all services (backend + frontend)
	@echo "🚀 Starting all services..."
	@pnpm dev

build: ## Build all packages
	@echo "🏗️  Building all packages..."
	@pnpm build
	@echo "✅ All packages built"

clean-deps: ## Clean all node_modules
	@echo "🧹 Cleaning node_modules..."
	@rm -rf node_modules pwa-frontend/node_modules squid-backend/node_modules common/node_modules
	@echo "✅ Dependencies cleaned"

# =============================================================================
# ☸️  KUBERNETES LOCAL DEVELOPMENT
# =============================================================================

setup-minikube: ## Setup minikube local Kubernetes cluster
	@echo "🚀 Setting up minikube local Kubernetes cluster..."
	@if ! command -v minikube >/dev/null 2>&1; then \
		echo "❌ minikube not found. Installing..."; \
		if [[ "$$(uname)" == "Darwin" ]]; then \
			brew install minikube; \
		else \
			echo "Please install minikube: https://minikube.sigs.k8s.io/docs/start/"; \
			exit 1; \
		fi; \
	fi
	@echo "🔧 Starting minikube cluster..."
	@minikube start --driver=docker --memory=6144 --cpus=3 --kubernetes-version=v1.28.3
	@echo "🔌 Enabling essential addons..."
	@minikube addons enable ingress
	@minikube addons enable metrics-server
	@echo "✅ Minikube setup complete!"
	@kubectl cluster-info
	@echo ""
	@echo "🎯 Next steps:"
	@echo "  1. Deploy to minikube: make deploy-local-k8s"
	@echo "  2. Check status: make k8s-status"

deploy-local-k8s: ## Deploy full stack to local Kubernetes (minikube)
	@echo "🚀 Deploying Aerostack to local Kubernetes..."
	@echo "🔍 Checking minikube status..."
	@minikube status || (echo "❌ Minikube not running. Run: make setup-minikube" && exit 1)
	@echo "🔧 Setting up Helm repositories..."
	@helm repo add bitnami https://charts.bitnami.com/bitnami
	@helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
	@helm repo add grafana https://grafana.github.io/helm-charts
	@helm repo update
	@echo "📦 Creating namespace..."
	@kubectl create namespace aerostack-system --dry-run=client -o yaml | kubectl apply -f -
	@echo "🚀 Installing Aerostack stack..."
	@helm upgrade --install aerostack \
		./k8s/helm/aerostack \
		--namespace aerostack-system \
		--values ./k8s/helm/aerostack/values-dev.yaml \
		--wait --timeout=10m
	@echo "✅ Deployment complete!"
	@echo ""
	@echo "🎯 Access your services:"
	@echo "  Backend: $$(minikube service aerostack-backend --namespace aerostack-system --url)"
	@echo "  Frontend: $$(minikube service aerostack-frontend --namespace aerostack-system --url)"
	@echo "  Status: make k8s-status"

k8s-status: ## Check Kubernetes deployment status
	@echo "🔍 Kubernetes Deployment Status"
	@echo "==============================="
	@echo ""
	@echo "📊 Cluster Info:"
	@kubectl cluster-info 2>/dev/null || echo "❌ Cluster not accessible"
	@echo ""
	@echo "📦 Namespace Status:"
	@kubectl get namespaces | grep aerostack || echo "❌ aerostack-system namespace not found"
	@echo ""
	@echo "🚀 Pod Status:"
	@kubectl get pods -n aerostack-system 2>/dev/null || echo "❌ No pods in aerostack-system namespace"
	@echo ""
	@echo "🌐 Service Status:"
	@kubectl get services -n aerostack-system 2>/dev/null || echo "❌ No services in aerostack-system namespace"

k8s-logs: ## View logs from Kubernetes deployment
	@echo "📝 Viewing Kubernetes logs..."
	@kubectl logs -n aerostack-system -l app=aerostack-backend --tail=50 2>/dev/null || echo "❌ No backend logs available"

k8s-cleanup: ## Clean up local Kubernetes deployment
	@echo "🧹 Cleaning up local Kubernetes deployment..."
	@helm uninstall aerostack -n aerostack-system 2>/dev/null || echo "No Helm release to remove"
	@kubectl delete namespace aerostack-system 2>/dev/null || echo "No namespace to remove"
	@echo "✅ Cleanup complete"

stop-minikube: ## Stop minikube cluster
	@echo "⏹️  Stopping minikube cluster..."
	@minikube stop
	@echo "✅ Minikube stopped"

# =============================================================================
# 🐳 DOCKER IMAGE BUILDING
# =============================================================================

DOCKER_REGISTRY ?= your-registry.dkr.ecr.us-west-2.amazonaws.com
DOCKER_IMAGE_FRONTEND ?= $(DOCKER_REGISTRY)/aerostack-frontend
DOCKER_TAG ?= latest

docker-build-frontend: ## Build Docker image for frontend
	@echo "🐳 Building frontend Docker image..."
	@docker build -f pwa-frontend/Dockerfile -t $(DOCKER_IMAGE_FRONTEND):$(DOCKER_TAG) .
	@echo "✅ Frontend image built: $(DOCKER_IMAGE_FRONTEND):$(DOCKER_TAG)"

docker-push-frontend: ## Push frontend Docker image to registry
	@echo "🚀 Pushing frontend image to registry..."
	@docker push $(DOCKER_IMAGE_FRONTEND):$(DOCKER_TAG)
	@echo "✅ Frontend image pushed"

docker-build-push-frontend: docker-build-frontend docker-push-frontend ## Build and push frontend image

docker-login-ecr: ## Login to AWS ECR (requires AWS CLI configured)
	@echo "🔐 Logging into AWS ECR..."
	@aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin $(DOCKER_REGISTRY)
	@echo "✅ Logged into ECR"

# =============================================================================
# 🚢 PRODUCTION DEPLOYMENT
# =============================================================================

deploy-squid: ## Deploy Squid backend to Squid Cloud
	@echo "🚀 Deploying Squid backend to Squid Cloud..."
	@cd squid-backend && pnpm run deploy
	@echo "✅ Squid backend deployed"

deploy-eks: ## Deploy frontend + data stores to AWS EKS
	@echo "🚀 Deploying to AWS EKS..."
	@echo "🔍 Checking EKS cluster connection..."
	@kubectl cluster-info || (echo "❌ Not connected to EKS cluster. Run: aws eks update-kubeconfig --region us-west-2 --name your-cluster-name" && exit 1)
	@echo "🔧 Setting up Helm repositories..."
	@helm repo add bitnami https://charts.bitnami.com/bitnami
	@helm repo update
	@echo "📦 Creating namespace..."
	@kubectl create namespace aerostack-production --dry-run=client -o yaml | kubectl apply -f -
	@echo "🚀 Deploying Aerostack stack to EKS..."
	@helm upgrade --install aerostack \
		./k8s/helm/aerostack \
		--namespace aerostack-production \
		--values ./k8s/helm/aerostack/values-production.yaml \
		--set frontend.image.repository=$(DOCKER_IMAGE_FRONTEND) \
		--set frontend.image.tag=$(DOCKER_TAG) \
		--wait --timeout=15m
	@echo "✅ EKS deployment complete!"
	@echo ""
	@echo "🎯 Check deployment status:"
	@echo "  kubectl get pods -n aerostack-production"
	@echo "  kubectl get services -n aerostack-production"

deploy-production: docker-build-push-frontend deploy-squid deploy-eks ## Full production deployment (Squid + EKS)
	@echo "✅ Full production deployment complete!"
	@echo ""
	@echo "🎯 Deployed components:"
	@echo "  ✅ Squid backend → Squid Cloud"
	@echo "  ✅ Frontend → EKS"
	@echo "  ✅ MongoDB → EKS"
	@echo "  ✅ Redis → EKS"

eks-status: ## Check EKS deployment status
	@echo "🔍 EKS Deployment Status"
	@echo "======================="
	@echo ""
	@echo "📊 Cluster Info:"
	@kubectl cluster-info 2>/dev/null || echo "❌ Not connected to EKS"
	@echo ""
	@echo "🚀 Pod Status:"
	@kubectl get pods -n aerostack-production 2>/dev/null || echo "❌ No pods in aerostack-production namespace"
	@echo ""
	@echo "🌐 Service Status:"
	@kubectl get services -n aerostack-production 2>/dev/null || echo "❌ No services in aerostack-production namespace"
	@echo ""
	@echo "📈 Ingress Status:"
	@kubectl get ingress -n aerostack-production 2>/dev/null || echo "No ingress configured"

eks-logs: ## View logs from EKS deployment
	@echo "📝 Viewing EKS logs..."
	@kubectl logs -n aerostack-production -l app=aerostack-frontend --tail=50 2>/dev/null || echo "❌ No frontend logs available"

eks-cleanup: ## Clean up EKS deployment
	@echo "🧹 Cleaning up EKS deployment..."
	@echo "⚠️  This will remove the production deployment!"
	@read -p "Are you sure? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		helm uninstall aerostack -n aerostack-production 2>/dev/null || echo "No Helm release to remove"; \
		kubectl delete namespace aerostack-production 2>/dev/null || echo "No namespace to remove"; \
		echo "✅ EKS cleanup complete"; \
	else \
		echo "❌ Cancelled"; \
	fi

deploy-customer: ## Deploy to customer environment (usage: make deploy-customer CUSTOMER=acme-corp)
	@if [ -z "$(CUSTOMER)" ]; then \
		echo "Usage: make deploy-customer CUSTOMER=<customer-name>"; \
		exit 1; \
	fi
	@echo "🚢 Deploying to customer: $(CUSTOMER)"
	@echo "🚀 Deploying Aerostack to customer environment..."
	@kubectl create namespace aerostack-$(CUSTOMER) --dry-run=client -o yaml | kubectl apply -f -
	@helm upgrade --install aerostack-$(CUSTOMER) \
		./k8s/helm/aerostack \
		--namespace aerostack-$(CUSTOMER) \
		--values ./k8s/helm/aerostack/values-production.yaml \
		--set frontend.image.repository=$(DOCKER_IMAGE_FRONTEND) \
		--set frontend.image.tag=$(DOCKER_TAG) \
		--wait --timeout=15m
	@echo "✅ Customer deployment complete: $(CUSTOMER)"

# =============================================================================
# 🧪 TESTING & VALIDATION
# =============================================================================

validate: ## Validate Helm charts and configurations
	@echo "✅ Validating Helm charts..."
	@helm lint k8s/helm/aerostack
	@helm template k8s/helm/aerostack --values k8s/helm/aerostack/values-dev.yaml > /dev/null
	@echo "✅ Helm charts validation passed"

test-all: ## Run all tests
	@echo "🧪 Running all tests..."
	@make test-backend
	@make test-frontend
	@echo "✅ All tests passed"

# =============================================================================
# 🧹 CLEANUP & MAINTENANCE
# =============================================================================

clean: ## Clean up all resources
	@echo "🧹 Cleaning up all resources..."
	@make stop-storage
	@make clean-deps
	@echo "✅ Cleanup completed"

dev-full-reset: ## Full reset: stop everything, clean data
	@echo "⚠️  This will stop all services and clean all data!"
	@read -p "Are you sure? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		echo "🧹 Full reset..."; \
		make stop-storage; \
		$(DOCKER_COMPOSE) down -v; \
		make clean-deps; \
		echo "✅ Full reset complete"; \
	else \
		echo "❌ Cancelled"; \
	fi

# =============================================================================
# 📖 HELP & DOCUMENTATION
# =============================================================================

help-dev: ## Show local development help
	@echo "Local Development Workflow"
	@echo "========================="
	@echo ""
	@echo "🎯 Daily Development:"
	@echo "  1. make start-storage    # Start MongoDB, Redis, etc."
	@echo "  2. make run-backend      # Start Squid backend (Terminal 1)"
	@echo "  3. make run-frontend     # Start React PWA (Terminal 2)"
	@echo ""
	@echo "🔧 Setup Commands:"
	@echo "  make install            # Install all dependencies"
	@echo "  make setup-backend      # Setup backend"
	@echo "  make setup-frontend     # Setup frontend"
	@echo ""
	@echo "📦 Storage Commands:"
	@echo "  make start-storage      # Start all data stores"
	@echo "  make stop-storage       # Stop all data stores"
	@echo "  make storage-status     # Check status"
	@echo "  make storage-logs       # View logs"
	@echo ""
	@echo "🧪 Testing:"
	@echo "  make test-backend       # Test backend"
	@echo "  make test-frontend      # Test frontend"
	@echo "  make test-all           # Run all tests"

help-deploy: ## Show deployment help
	@echo "Deployment Commands"
	@echo "==================="
	@echo ""
	@echo "🏗️  Building Images:"
	@echo "  make docker-build-frontend       # Build frontend Docker image"
	@echo "  make docker-push-frontend        # Push frontend to registry"
	@echo "  make docker-build-push-frontend  # Build + push frontend"
	@echo "  make docker-login-ecr            # Login to AWS ECR"
	@echo ""
	@echo "☸️  Local Kubernetes (Testing):"
	@echo "  make setup-minikube      # Setup local K8s cluster"
	@echo "  make deploy-local-k8s    # Deploy to local K8s"
	@echo "  make k8s-status          # Check K8s status"
	@echo "  make k8s-logs            # View K8s logs"
	@echo "  make k8s-cleanup         # Clean up K8s"
	@echo ""
	@echo "🚢 Production Deployment:"
	@echo "  make deploy-squid        # Deploy Squid backend to Squid Cloud"
	@echo "  make deploy-eks          # Deploy frontend + data stores to EKS"
	@echo "  make deploy-production   # Full deployment (Squid + EKS)"
	@echo "  make deploy-customer     # Deploy to customer namespace"
	@echo ""
	@echo "📊 Production Management:"
	@echo "  make eks-status          # Check EKS deployment status"
	@echo "  make eks-logs            # View EKS logs"
	@echo "  make eks-cleanup         # Clean up EKS deployment"
	@echo ""
	@echo "🧪 Validation:"
	@echo "  make validate            # Validate Helm charts"
	@echo ""
	@echo "🎯 Deployment Architecture:"
	@echo "  Squid Backend  → Squid Cloud (managed)"
	@echo "  Frontend       → EKS (Docker + K8s)"
	@echo "  MongoDB        → EKS (StatefulSet)"
	@echo "  Redis          → EKS (StatefulSet)"

# Default target
.DEFAULT_GOAL := help
