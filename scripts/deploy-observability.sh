#!/bin/bash
set -e

echo "Deploying kube-prometheus-stack..."
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm install observability prometheus-community/kube-prometheus-stack \
  --namespace aerostack-monitoring \
  --create-namespace \
  --set grafana.enabled=true \
  --set prometheus.enabled=true

echo "Observability stack deployed."
