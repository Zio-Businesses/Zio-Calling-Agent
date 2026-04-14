# Terminal Command History

This document tracks all critical commands used to stabilize the AgentLabs environment, resolve port conflicts, and perform the fresh installation.

## 🐳 Docker Lifecycle & Deployment
| Command | Description |
| :--- | :--- |
| `docker compose down -v` | **The Nuclear Wipe**: Stops all containers and deletes all persistent data volumes (for a fresh start). |
| `docker compose down` | Gracefully stops the stack without deleting data. |
| `docker compose up -d --build` | Builds the application image and starts the stack in the background. |
| `docker compose build --no-cache app` | **The Cache-Buster**: Forces a complete rebuild from scratch, ignoring all previous history. |
| `docker compose restart app` | Quickly restarts the app container to refresh settings/logs. |
| `docker compose ps -a` | Lists all containers and their health/status. |

## 🗄️ Database Initialization (Inside Container)
| Command | Description |
| :--- | :--- |
| `docker exec -it agentlabs-app npm run db:push` | Syncs the database tables with the latest schema (Drizzle Kit). |
| `docker exec -it agentlabs-app drizzle-kit push` | Direct call to the global Drizzle tool for schema synchronization. |
| `docker exec -it agentlabs-app npm run db:seed` | Populates the database with default languages, countries, and plugin data. |
| `docker exec -it agentlabs-app npm run db:migrate` | Runs formal Migration scripts (alternative to push). |

## 🔍 Diagnostics & Troubleshooting
| Command | Description |
| :--- | :--- |
| `docker logs --tail 50 agentlabs-app` | Shows the most recent 50 lines of activity from the server. |
| `docker exec agentlabs-app ls -R /app` | Inspects the internal folder structure of the running container. |
| `docker exec agentlabs-app npm list tsx` | Verifies that specific packages were successfully installed inside Docker. |
| `netstat -ano | findstr :5432` | Identifies if another program (like Windows Relay) is blocking port 5432. |
| `tasklist /FI "IMAGENAME eq Docker Desktop.exe"` | Verifies if the Docker engine is currently running on Windows. |

## 🛠️ Git & Repository Migration
| Command | Description |
| :--- | :--- |
| `git init` | Initializes a new repository in the project folder. |
| `git add .` | Stages all files for tracking (including new configurations). |
| `git commit -m "first commit"` | Finalizes the current state into the project history. |
| `git push -u origin main` | Uploads the stabilized project to your GitHub repository. |

---
> [!NOTE]
> All `docker exec` commands are performed **inside** the container, as the database is now isolated for maximum stability on Windows.
