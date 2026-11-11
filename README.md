# NexusFlow — Visual IoT Telemetry & Rule Engine

NexusFlow is a visual IoT pipeline builder for factory telemetry. Week 1 establishes the application foundation: a React Flow canvas, an Express ingestion API, and MongoDB Time-Series persistence.

## Week 1 scope
- React + TypeScript + Vite frontend with a drag-and-drop React Flow canvas.
- Starter nodes for sensor input, moving-average processing, and alert actions.
- Local graph save/restore, starter-graph reset, node deletion, and responsive workspace layout.
- Express + TypeScript backend with health, single-event, batch-ingestion, and recent-telemetry endpoints.
- MongoDB native time-series collection (telemetry) with timestamp as the time field and metadata as the metadata field.
- Environment-based configuration, request validation, bounded batch size, and graceful server shutdown.

> Week 1 is the foundation only. The RxJS graph compiler, live WebSocket execution, dashboards, and outbound webhooks are scheduled for later weeks.

## Requirements
- Node.js 20+
- MongoDB 5.0+ (local instance or MongoDB Atlas)
- npm 10+

## Quick start
1. Run npm install at the repository root.
2. Run npm run install:all.
3. Copy server/.env.example to server/.env and set MONGODB_URI.
4. Run npm run dev.

- Frontend: http://localhost:5173
- API: http://localhost:3001
- Health: http://localhost:3001/api/health

## Frontend workflow
- Add sensor, processing, and action nodes from the node library.
- Drag nodes and connect compatible ports to shape a telemetry pipeline.
- Select a node and press Backspace or Delete to remove it.
- Use **Save graph** to store the current canvas in browser local storage; saved graphs are restored on the next visit in the same browser.
- Use **Reset starter** to return to the initial example pipeline and clear the saved draft.

The graph editor is currently a visual foundation. Saving a graph stores its layout locally; it does not yet compile or execute telemetry rules against the backend.

## API
- GET /api/health — service and database status.
- POST /api/telemetry — ingest one telemetry point.
- POST /api/telemetry/batch — ingest { readings: [...] }, 1–1000 readings per request.
- GET /api/telemetry/recent?deviceId=turbine-01&limit=50 — recent points (maximum 200).

Example telemetry payload:
```json
{
  "deviceId": "turbine-01",
  "metric": "temperature",
  "value": 74.2,
  "unit": "celsius",
  "timestamp": "2026-11-10T08:00:00.000Z",
  "location": "factory-floor-a"
}
```

## Environment
See server/.env.example. Never commit real credentials.

## Project layout
- client/ — React Flow application
- server/ — Express API and MongoDB time-series persistence

## Verification
Run npm run typecheck and npm run build. For API checks, start the server with MongoDB configured. Throughput targets must be benchmarked on target database and hardware; this scaffold makes no unverified write-rate claim.