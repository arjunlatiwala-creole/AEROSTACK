# Aerostack Kubernetes Deployment

This directory contains Kubernetes and Helm configurations for deploying Aerostack to Kubernetes clusters.

## 📁 Directory Structure

```
k8s/
├── helm/aerostack/              # Helm chart for Aerostack
│   ├── Chart.yaml          # Chart metadata and dependencies
│   ├── values.yaml         # Default values
│   ├── values-dev.yaml     # Development overrides
│   ├── values-production.yaml  # Production configuration
│   └── templates/          # Kubernetes manifest templates
├── secrets-template.yaml   # Secrets template (DO NOT commit filled version)
└── README.md              # This file
```

## 🚀 Quick Start

### Prerequisites

**Required Tools:**
- `kubectl` (v1.24+)
- `helm` (v3.8+)
- `docker` (for building images)
- `skaffold` (optional, for local development)

**For Local Development:**
- `minikube` or `kind` or `Docker Desktop with Kubernetes`

### 1. Local Development with Skaffold (Recommended)

```bash
# Start minikube or kind
minikube start --cpus=4 --memory=8192 --disk-size=20g

# Run Aerostack with Skaffold (auto-rebuild and deploy)
skaffold dev

# Or run in the background
skaffold run

# Clean up
skaffold delete
```

### 2. Manual Local Deployment

```bash
# Build Docker images
docker build -t enterprise/aerostack-frontend:dev -f pwa-frontend/Dockerfile .
docker build -t enterprise/aerostack-backend:dev -f squid-backend/Dockerfile .

# If using minikube, load images
minikube image load enterprise/aerostack-frontend:dev
minikube image load enterprise/aerostack-backend:dev

# Add Helm repositories
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update

# Install or upgrade Aerostack
helm upgrade --install aerostack ./k8s/helm/aerostack \
  --namespace aerostack-dev \
  --create-namespace \
  --values k8s/helm/aerostack/values-dev.yaml \
  --set frontend.image.tag=dev \
  --set backend.image.tag=dev \
  --wait

# Check deployment status
kubectl get pods -n aerostack-dev
kubectl get svc -n aerostack-dev

# Port forward to access services
kubectl port-forward -n aerostack-dev svc/aerostack-frontend 5173:80 &
kubectl port-forward -n aerostack-dev svc/aerostack-backend 8000:8000 &

# Access the application
open http://localhost:5173
```

## 🏭 Production Deployment

### AWS EKS Example

```bash
# Configure AWS credentials
aws configure
export AWS_REGION=us-west-2

# Create EKS cluster (if not exists)
eksctl create cluster \
  --name aerostack-prod \
  --region us-west-2 \
  --nodegroup-name aerostack-nodes \
  --node-type m5.large \
  --nodes 3 \
  --nodes-min 3 \
  --nodes-max 10 \
  --managed

# Update kubeconfig
aws eks update-kubeconfig --region us-west-2 --name aerostack-prod

# Create secrets (see secrets section below)
kubectl create namespace aerostack
kubectl apply -f k8s/secrets.yaml

# Build and push images to registry
docker build -t your-registry.io/enterprise/aerostack-frontend:v1.0.0 -f pwa-frontend/Dockerfile .
docker build -t your-registry.io/enterprise/aerostack-backend:v1.0.0 -f squid-backend/Dockerfile .
docker push your-registry.io/enterprise/aerostack-frontend:v1.0.0
docker push your-registry.io/enterprise/aerostack-backend:v1.0.0

# Deploy with Helm
helm upgrade --install aerostack ./k8s/helm/aerostack \
  --namespace aerostack \
  --values k8s/helm/aerostack/values-production.yaml \
  --set frontend.image.repository=your-registry.io/enterprise/aerostack-frontend \
  --set frontend.image.tag=v1.0.0 \
  --set backend.image.repository=your-registry.io/enterprise/aerostack-backend \
  --set backend.image.tag=v1.0.0 \
  --wait --timeout 10m

# Verify deployment
kubectl get all -n aerostack
kubectl get ingress -n aerostack
```

## 🔐 Secrets Management

### Create Secrets

```bash
# Copy template
cp k8s/secrets-template.yaml k8s/secrets.yaml

# Edit and fill in actual values
# IMPORTANT: Never commit secrets.yaml to git (it's in .gitignore)
vim k8s/secrets.yaml

# Apply secrets
kubectl apply -f k8s/secrets.yaml
```

### Using External Secrets (Recommended for Production)

```bash
# Install external-secrets-operator
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets \
  --create-namespace

# Configure secret store (AWS Secrets Manager example)
kubectl apply -f - <<EOF
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: aws-secrets-manager
  namespace: aerostack
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-west-2
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets-sa
EOF

# Create external secrets
kubectl apply -f - <<EOF
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: postgresql-credentials
  namespace: aerostack
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: SecretStore
  target:
    name: postgresql-credentials
  data:
  - secretKey: url
    remoteRef:
      key: aerostack/postgresql-url
EOF
```

## 📊 Monitoring

### Access Grafana (if monitoring enabled)

```bash
# Get Grafana admin password
kubectl get secret -n aerostack grafana -o jsonpath="{.data.admin-password}" | base64 --decode

# Port forward
kubectl port-forward -n aerostack svc/grafana 3000:80

# Access at http://localhost:3000
```

### View Logs

```bash
# Backend logs
kubectl logs -n aerostack -l app.kubernetes.io/component=backend --tail=100 -f

# Frontend logs
kubectl logs -n aerostack -l app.kubernetes.io/component=frontend --tail=100 -f

# All pods
kubectl logs -n aerostack --all-containers=true --tail=100 -f
```

## 🔧 Troubleshooting

### Check Pod Status

```bash
kubectl get pods -n aerostack
kubectl describe pod -n aerostack <pod-name>
kubectl logs -n aerostack <pod-name>
```

### Check Services

```bash
kubectl get svc -n aerostack
kubectl get endpoints -n aerostack
```

### Test Database Connectivity

```bash
# PostgreSQL
kubectl run psql-test --image=postgres:16 -it --rm --restart=Never -- \
  psql -h postgres -U agent -d agentdb

# Note: RabbitMQ removed - using AWS SQS instead
```

### Debug Network Issues

```bash
# Check DNS resolution
kubectl run dns-test --image=busybox -it --rm --restart=Never -- \
  nslookup aerostack-backend

# Check service connectivity
kubectl run curl-test --image=curlimages/curl -it --rm --restart=Never -- \
  curl -v http://aerostack-backend:8000/health
```

## 🔄 Scaling

### Manual Scaling

```bash
# Scale backend
kubectl scale deployment -n aerostack aerostack-backend --replicas=5

# Scale frontend
kubectl scale deployment -n aerostack aerostack-frontend --replicas=3
```

### Auto-scaling (HPA)

Auto-scaling is configured in Helm values:

```yaml
backend:
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 15
    targetCPUUtilizationPercentage: 70
```

Check HPA status:

```bash
kubectl get hpa -n aerostack
kubectl describe hpa -n aerostack aerostack-backend
```

## 🔄 Updates and Rollbacks

### Update Application

```bash
# Build new image
docker build -t your-registry.io/enterprise/aerostack-backend:v1.1.0 -f squid-backend/Dockerfile .
docker push your-registry.io/enterprise/aerostack-backend:v1.1.0

# Upgrade Helm release
helm upgrade aerostack ./k8s/helm/aerostack \
  --namespace aerostack \
  --set backend.image.tag=v1.1.0 \
  --reuse-values

# Check rollout status
kubectl rollout status deployment/aerostack-backend -n aerostack
```

### Rollback

```bash
# Rollback to previous version
helm rollback aerostack -n aerostack

# Or rollback deployment
kubectl rollout undo deployment/aerostack-backend -n aerostack

# Check rollout history
helm history aerostack -n aerostack
kubectl rollout history deployment/aerostack-backend -n aerostack
```

## 🧹 Cleanup

### Remove Aerostack

```bash
# Uninstall Helm release
helm uninstall aerostack -n aerostack

# Delete namespace (includes all resources)
kubectl delete namespace aerostack

# For development
skaffold delete
```

## 📚 Additional Resources

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Helm Documentation](https://helm.sh/docs/)
- [Skaffold Documentation](https://skaffold.dev/docs/)
- [enterprise-lyzr-baseline Reference](https://github.com/enterpriseio/enterprise-lyzr-baseline)

## 🆘 Support

For issues or questions:
1. Check the [troubleshooting section](#-troubleshooting)
2. Review logs with `kubectl logs`
3. Contact the enterprise team

