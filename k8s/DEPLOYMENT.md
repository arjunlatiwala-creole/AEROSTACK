# Aerostack Kubernetes Deployment Guide

Complete guide for deploying Aerostack to Kubernetes, adapted from enterprise-lyzr-baseline architecture.

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [Architecture Overview](#architecture-overview)
- [Local Development](#local-development)
- [Cloud Deployment](#cloud-deployment)
- [Production Best Practices](#production-best-practices)
- [Monitoring & Observability](#monitoring--observability)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Tools

| Tool | Version | Installation |
|------|---------|--------------|
| kubectl | 1.24+ | `brew install kubectl` |
| helm | 3.8+ | `brew install helm` |
| docker | 20.10+ | https://docker.com |
| skaffold | 2.0+ (optional) | `brew install skaffold` |

### For Local Development

Choose one:
- **minikube**: `brew install minikube`
- **kind**: `brew install kind`
- **Docker Desktop**: Enable Kubernetes in settings

### For Cloud Deployment

- **AWS**: `aws-cli`, `eksctl`
- **GCP**: `gcloud`, `gke-gcloud-auth-plugin`
- **Azure**: `az cli`

## Architecture Overview

### Components

```
┌─────────────────────────────────────────────────────────┐
│                    Ingress Controller                    │
│                  (nginx/traefik/AWS ALB)                 │
└────────────────────┬────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
    ┌────▼─────┐          ┌─────▼────┐
    │ Frontend │          │ Backend  │
    │  (PWA)   │◄────────►│ (Squid)  │
    │  Nginx   │          │ Node.js  │
    └──────────┘          └─────┬────┘
                                │
                    ┌───────────┼───────────┐
                    │           │           │
              ┌─────▼────┐ ┌───▼────┐ ┌───▼────┐
              │PostgreSQL│ │RabbitMQ│ │ Redis  │
              └──────────┘ └────────┘ └────────┘
```

### Key Features

- **✅ Auto-scaling**: HPA for frontend and backend
- **✅ High Availability**: Multi-replica deployments
- **✅ Health Checks**: Liveness and readiness probes
- **✅ Secrets Management**: Kubernetes secrets or External Secrets Operator
- **✅ Monitoring**: Prometheus and Grafana (optional)
- **✅ TLS/SSL**: cert-manager integration

## Local Development

### Option 1: Skaffold (Recommended)

**Fastest iteration cycle with auto-rebuild:**

```bash
# Start local cluster
minikube start --cpus=4 --memory=8192

# Deploy and watch for changes
skaffold dev

# In another terminal, access services
open http://localhost:5173  # Frontend
curl http://localhost:8000/health  # Backend
```

### Option 2: Makefile

**Traditional approach:**

```bash
# Build and deploy locally
make deploy-local

# Port forward to access services
make port-forward

# View logs
make logs

# Clean up
make clean-local
```

### Option 3: Manual Helm

**Full control:**

```bash
# Build images
docker build -t enterprise/aerostack-frontend:dev -f pwa-frontend/Dockerfile .
docker build -t enterprise/aerostack-backend:dev -f squid-backend/Dockerfile .

# Load into minikube
minikube image load enterprise/aerostack-frontend:dev
minikube image load enterprise/aerostack-backend:dev

# Deploy
helm upgrade --install aerostack ./k8s/helm/aerostack \
  --namespace aerostack-dev \
  --create-namespace \
  --values k8s/helm/aerostack/values-dev.yaml \
  --wait

# Access
kubectl port-forward -n aerostack-dev svc/aerostack-frontend 5173:80 &
kubectl port-forward -n aerostack-dev svc/aerostack-backend 8000:8000 &
```

## Cloud Deployment

### AWS EKS

#### 1. Create Cluster

```bash
eksctl create cluster \
  --name aerostack-prod \
  --region us-west-2 \
  --nodegroup-name aerostack-nodes \
  --node-type m5.xlarge \
  --nodes 3 \
  --nodes-min 3 \
  --nodes-max 10 \
  --managed \
  --with-oidc

# Update kubeconfig
aws eks update-kubeconfig --region us-west-2 --name aerostack-prod
```

#### 2. Install Add-ons

```bash
# AWS Load Balancer Controller
eksctl utils associate-iam-oidc-provider \
  --region us-west-2 \
  --cluster aerostack-prod \
  --approve

# Install controller
helm repo add eks https://aws.github.io/eks-charts
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=aerostack-prod

# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.3/cert-manager.yaml
```

#### 3. Deploy Aerostack

```bash
# Create secrets (use AWS Secrets Manager in production)
kubectl create namespace aerostack
kubectl apply -f k8s/secrets.yaml

# Deploy with Makefile
make deploy-eks

# Or with Helm directly
helm upgrade --install aerostack ./k8s/helm/aerostack \
  --namespace aerostack \
  --values k8s/helm/aerostack/values-production.yaml \
  --set global.domain=aerostack.yourdomain.com \
  --wait --timeout 15m
```

### GCP GKE

```bash
# Create cluster
gcloud container clusters create aerostack-prod \
  --region us-central1 \
  --machine-type n1-standard-4 \
  --num-nodes 3 \
  --enable-autoscaling \
  --min-nodes 3 \
  --max-nodes 10

# Get credentials
gcloud container clusters get-credentials aerostack-prod --region us-central1

# Deploy
make deploy-production
```

### Azure AKS

```bash
# Create cluster
az aks create \
  --resource-group aerostack-rg \
  --name aerostack-prod \
  --node-count 3 \
  --enable-addons monitoring \
  --node-vm-size Standard_D4s_v3

# Get credentials
az aks get-credentials --resource-group aerostack-rg --name aerostack-prod

# Deploy
make deploy-production
```

## Production Best Practices

### 1. Secrets Management

**❌ Don't:** Store secrets in values.yaml

**✅ Do:** Use External Secrets Operator

```bash
# Install External Secrets Operator
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets \
  --create-namespace

# Configure AWS Secrets Manager
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
EOF
```

### 2. Resource Limits

Always set resource requests and limits:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    cpu: "2000m"
    memory: "4Gi"
```

### 3. High Availability

- **Multiple replicas**: ≥ 3 for production
- **Pod Disruption Budgets**: Prevent service disruption
- **Anti-affinity rules**: Spread pods across nodes
- **Health checks**: Proper liveness/readiness probes

### 4. Monitoring

```bash
# Enable monitoring
helm upgrade aerostack ./k8s/helm/aerostack \
  --set monitoring.enabled=true \
  --reuse-values

# Access Grafana
kubectl port-forward -n aerostack svc/grafana 3000:80
```

### 5. Backup Strategy

```bash
# Database backups
kubectl exec -n aerostack deployment/postgresql -- \
  pg_dump -U agent -d agentdb > backup-$(date +%Y%m%d).sql

# Velero for cluster backup
velero install \
  --provider aws \
  --bucket aerostack-backups \
  --backup-location-config region=us-west-2

velero schedule create aerostack-daily --schedule="0 2 * * *"
```

## Monitoring & Observability

### Prometheus Metrics

```bash
# Port forward Prometheus
kubectl port-forward -n aerostack svc/prometheus 9090:9090

# Access at http://localhost:9090
```

### Grafana Dashboards

```bash
# Get admin password
kubectl get secret -n aerostack grafana \
  -o jsonpath="{.data.admin-password}" | base64 --decode

# Port forward
kubectl port-forward -n aerostack svc/grafana 3000:80

# Access at http://localhost:3000
```

### Logs

```bash
# All logs
make logs

# Backend only
make logs-backend

# Frontend only
make logs-frontend

# Specific pod
kubectl logs -n aerostack <pod-name> -f
```

## Troubleshooting

### Common Issues

#### Pods Not Starting

```bash
# Check pod status
kubectl get pods -n aerostack
kubectl describe pod -n aerostack <pod-name>

# Check events
kubectl get events -n aerostack --sort-by='.lastTimestamp'

# Check logs
kubectl logs -n aerostack <pod-name> --previous
```

#### Image Pull Errors

```bash
# Check image pull secrets
kubectl get secrets -n aerostack

# Create image pull secret
kubectl create secret docker-registry regcred \
  --docker-server=your-registry.io \
  --docker-username=your-username \
  --docker-password=your-password \
  -n aerostack
```

#### Database Connection Issues

```bash
# Test database connectivity
kubectl run psql-test --image=postgres:16 -it --rm --restart=Never -n aerostack -- \
  psql -h postgres -U agent -d agentdb

# Check database logs
kubectl logs -n aerostack -l app.kubernetes.io/name=postgresql
```

#### Service Not Accessible

```bash
# Check service endpoints
kubectl get svc -n aerostack
kubectl get endpoints -n aerostack

# Test internal connectivity
kubectl run curl-test --image=curlimages/curl -it --rm --restart=Never -n aerostack -- \
  curl -v http://aerostack-backend:8000/health
```

### Performance Issues

```bash
# Check resource usage
kubectl top pods -n aerostack
kubectl top nodes

# Check HPA status
kubectl get hpa -n aerostack
kubectl describe hpa -n aerostack aerostack-backend

# Scale manually if needed
kubectl scale deployment -n aerostack aerostack-backend --replicas=10
```

### Debug Mode

```bash
# Enable debug logging
kubectl set env deployment/aerostack-backend -n aerostack LOG_LEVEL=debug

# Restart pods
kubectl rollout restart deployment/aerostack-backend -n aerostack
```

## CI/CD Integration

### GitHub Actions

See `.github/workflows/k8s-deploy.yml` for full pipeline.

**Key features:**
- Automated builds on push/PR
- Deploy to dev on develop branch
- Deploy to staging/prod on tags
- Smoke tests after deployment

### Manual Release

```bash
# Tag release
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0

# Build and push images
make docker-build IMAGE_TAG=v1.0.0
make docker-push IMAGE_TAG=v1.0.0

# Deploy to production
make deploy-production
```

## Rollback

```bash
# Helm rollback
helm history aerostack -n aerostack
helm rollback aerostack 1 -n aerostack

# Kubernetes rollback
kubectl rollout history deployment/aerostack-backend -n aerostack
kubectl rollout undo deployment/aerostack-backend -n aerostack
```

## Cleanup

```bash
# Remove deployment
make undeploy

# Remove everything including namespace
make clean

# Remove local development
make clean-local
```

## Additional Resources

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Helm Documentation](https://helm.sh/docs/)
- [enterprise-lyzr-baseline Architecture](https://github.com/enterpriseio/enterprise-lyzr-baseline)
- [Aerostack README](../README.md)

## Support

For issues or questions:
1. Check logs: `make logs`
2. Review [Troubleshooting](#troubleshooting)
3. Contact enterprise team

