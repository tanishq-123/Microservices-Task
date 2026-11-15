# Microservices on Kubernetes (Minikube)

Four Node.js services deployed on Minikube: **user (3000)**, **product (3001)**, **order (3002)** and **gateway (3003)**.
Every Service is `ClusterIP`. The gateway reaches the other services through cluster DNS names
(`user-service`, `product-service`, `order-service`).

## Project layout
```
Microservices/
├── user-service/  product-service/  order-service/  gateway-service/   (app.js, package.json, Dockerfile)
└── submission/
    ├── deployments/   *-deployment.yaml
    └── services/      *-service.yaml
```

## 1. Prerequisites
Docker Desktop (running), `minikube`, `kubectl`.

![Tool versions](screenshots/01-tool-versions.png)

## 2. Minikube setup
```bash
minikube start --driver=docker --cpus=2 --memory=4096
minikube status
kubectl config current-context     # must print: minikube
kubectl get nodes                  # minikube   Ready
```
![Minikube start](screenshots/02-minikube-start.png)
![Minikube status and node Ready](screenshots/03-minikube-status-nodes.png)

## 3. Build images and load them into Minikube
The manifests use `imagePullPolicy: Never`, so the images must exist inside the Minikube node.
Build them with Docker, then load them in:
```bash
cd Microservices
docker build -t user-service:1.0     ./user-service
docker build -t product-service:1.0  ./product-service
docker build -t order-service:1.0    ./order-service
docker build -t gateway-service:1.0  ./gateway-service

minikube image load user-service:1.0
minikube image load product-service:1.0
minikube image load order-service:1.0
minikube image load gateway-service:1.0
minikube image ls | grep service
```
![Images built in Docker](screenshots/04-docker-images-built.png)
![Images loaded into Minikube](screenshots/05-minikube-image-load.png)

> `order-service/app.js` needed a fix: `orders` was never declared, so `/orders` threw a ReferenceError.
> The fix is `const orders = [];`.

## 4. Deploy
```bash
kubectl apply -f submission/deployments/
kubectl apply -f submission/services/
kubectl get pods
kubectl get svc
```
All four pods reach `1/1 Running`.

![Apply and pods Running](screenshots/06-kubectl-apply-pods-running.png)

## 5. Test with port-forward
One terminal per command:
```bash
kubectl port-forward svc/user-service    3000:3000
kubectl port-forward svc/product-service 3001:3001
kubectl port-forward svc/order-service   3002:3002
kubectl port-forward svc/gateway-service 3003:3003
```

### 5.1 Each service directly
| Service | URL | Result |
|---|---|---|
| User | `localhost:3000/users` | ![](screenshots/07-user-service-3000-users.png) |
| Product | `localhost:3001/products` | ![](screenshots/08-product-service-3001-products.png) |
| Order (empty) | `localhost:3002/orders` | ![](screenshots/09-order-service-3002-orders-empty.png) |

### 5.2 Through the gateway
```bash
curl localhost:3003/health
curl localhost:3003/api/users
curl localhost:3003/api/products
curl -X POST localhost:3003/api/orders -H 'Content-Type: application/json' -d '{"userId":1,"productId":2}'
curl localhost:3003/api/orders
```
![Gateway health](screenshots/10-gateway-3003-health.png)
![Gateway /api/users](screenshots/11-gateway-api-users.png)
![Gateway /api/products](screenshots/12-gateway-api-products.png)
![Create and list order via gateway](screenshots/13-gateway-post-and-get-orders.png)

The order created through the gateway appears in the order service itself, so the gateway-to-order call worked:

![Order service after POST](screenshots/14-order-service-3002-after-post.png)

## 6. Inter-service communication from inside the cluster
```bash
kubectl exec deploy/gateway-service -- wget -qO- http://user-service:3000/users
kubectl exec deploy/gateway-service -- wget -qO- http://product-service:3001/products
kubectl exec deploy/gateway-service -- wget -qO- http://order-service:3002/orders
```
The gateway pod reaches all three services by Service name, which shows that DNS discovery works.

![Exec from gateway pod](screenshots/15-exec-inter-service-communication.png)

## 7. Logs
```bash
kubectl logs deploy/gateway-service
kubectl logs deploy/order-service
```
![Pod logs](screenshots/16-pod-logs.png)

## 8. Ingress (host-based routing)

### 8.1 Enable the NGINX Ingress controller
```bash
minikube addons enable ingress
kubectl wait -n ingress-nginx --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller --timeout=180s
kubectl get pods -n ingress-nginx
```

![Ingress addon enabled, controller ready](screenshots/17-ingress-addon-enabled.png)

### 8.2 Apply the Ingress resources
```bash
kubectl apply -f submission/ingress/
kubectl get ingress
```
![Ingress resources created](screenshots/18-ingress-applied.png)

Routing rules for host `microservices.local`:

| Path | Backend | Rewritten to |
|---|---|---|
| `/api/users` | user-service:3000 | `/users` |
| `/api/products` | product-service:3001 | `/products` |
| `/api/orders` | order-service:3002 | `/orders` |
| `/` | gateway-service:3003 | unchanged |

The services serve `/users`, `/products` and `/orders` without the `/api` prefix, so each `/api/*` path is rewritten before it reaches the service.
`rewrite-target` applies to a whole Ingress resource, which is why there is one Ingress per rewritten path plus one for the gateway.

### 8.3 Reach the Ingress from macOS (Docker driver)
```bash
echo "127.0.0.1 microservices.local" | sudo tee -a /etc/hosts
minikube tunnel        # keep this terminal open; it asks for your password
```
![Hosts entry and tunnel started](screenshots/19-hosts-entry-and-tunnel.png)

### 8.4 Test
```bash
curl http://microservices.local/api/users
curl http://microservices.local/api/products
curl http://microservices.local/api/orders
curl http://microservices.local/health          # "/" -> gateway
```
![Requests through the Ingress](screenshots/20-ingress-curl-tests.png)

Without the hosts entry, use `curl -H "Host: microservices.local" http://127.0.0.1/api/users`.

Confirm which backend served each request:
```bash
kubectl logs -n ingress-nginx -l app.kubernetes.io/component=controller --tail=20
```
The log lines name the upstream, for example `default-user-service-3000`.

![Ingress controller logs showing upstream per path](screenshots/21-ingress-controller-logs.png)

## 9. Troubleshooting
| Symptom | Cause / fix |
|---|---|
| `failed to download openapi ... eks.amazonaws.com` | `kubectl` points at another cluster. Run `kubectl config use-context minikube`. |
| `connection refused` on `127.0.0.1:<port>` | Minikube stopped. Run `minikube start`, then `minikube update-context`. |
| `No such container: minikube` | Docker Desktop lost the container. Run `minikube delete --all --purge`, then `minikube start`, then reload the images. |
| `ErrImageNeverPull` | The image is not in Minikube. Run `minikube image load <name>:1.0` and `kubectl rollout restart deploy/<name>`. |
| Pod `0/1` Ready | Readiness probe failing. Check `kubectl describe pod <name>`. |
| Gateway returns `Error fetching ...` | Check `kubectl get svc` and `kubectl get endpoints`. |
| `address already in use` on port-forward | Stop the old port-forward or use another local port. |
| `failed calling webhook` on Ingress apply | Controller not ready yet. Wait for the `ingress-nginx` controller pod, then apply again. |
| `404` from `/api/users` via Ingress | Check the `rewrite-target` annotation and the Ingress `PATH`/`HOST` in `kubectl describe ingress`. |
| `microservices.local` not resolving or hanging | Add the `/etc/hosts` entry and keep `minikube tunnel` running. |

## 10. Cleanup
```bash
kubectl delete -f submission/services/ -f submission/deployments/
minikube stop     # or: minikube delete
```