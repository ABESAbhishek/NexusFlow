import { useCallback, useMemo, useState } from "react";
import {
  Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow,
  addEdge, useEdgesState, useNodesState, type Connection, type Node,
  type NodeTypes, Handle, Position
} from "@xyflow/react";
import { Activity, AlertTriangle, Cpu, Database, Gauge, Plus, Radio, Save, Workflow } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

type PipelineNodeData = {
  title: string;
  subtitle: string;
  accent: string;
  sensorType?: string;
  unit?: string;
  operation?: string;
  windowSize?: number;
  alertType?: string;
  threshold?: number;
  message?: string;
};

function SensorNode({ data }: { data: PipelineNodeData }) {
  return <div className="pipeline-node sensor-node">
    <Handle type="source" position={Position.Right} />
    <div className="node-icon"><Radio size={16} /></div>
    <div><strong>{data.title}</strong><span>{data.subtitle}</span></div>
    <i className="status-dot" />
  </div>;
}

function FilterNode({ data }: { data: PipelineNodeData }) {
  return <div className="pipeline-node filter-node">
    <Handle type="target" position={Position.Left} />
    <Handle type="source" position={Position.Right} />
    <div className="node-icon"><Gauge size={16} /></div>
    <div><strong>{data.title}</strong><span>{data.subtitle}</span></div>
  </div>;
}

function AlertNode({ data }: { data: PipelineNodeData }) {
  return <div className="pipeline-node alert-node">
    <Handle type="target" position={Position.Left} />
    <div className="node-icon"><AlertTriangle size={16} /></div>
    <div><strong>{data.title}</strong><span>{data.subtitle}</span></div>
  </div>;
}

const nodeTypes: NodeTypes = { sensor: SensorNode, filter: FilterNode, alert: AlertNode };
const telemetryData = [
  { time: "10:00", temperature: 28 },
  { time: "10:05", temperature: 32 },
  { time: "10:10", temperature: 30 },
  { time: "10:15", temperature: 36 },
  { time: "10:20", temperature: 34 },
  { time: "10:25", temperature: 42 },
  { time: "10:30", temperature: 39 },
  { time: "10:35", temperature: 45 }
];

function TelemetryChart() {
  return (
    <div className="telemetry-panel">
      <div className="telemetry-heading">
        <div>
          <span className="eyebrow">SENSOR ANALYTICS</span>
          <h2>Temperature telemetry</h2>
        </div>
        <span className="telemetry-unit">°C · SIMULATED DATA</span>
      </div>

      <div className="telemetry-stats">
        <div className="telemetry-stat">
          <span>Current</span>
          <strong>{telemetryData[telemetryData.length - 1].temperature}°C</strong>
        </div>

        <div className="telemetry-stat">
          <span>Average</span>
          <strong>
            {(telemetryData.reduce((sum, item) => sum + item.temperature, 0) / telemetryData.length).toFixed(1)}°C
          </strong>
        </div>

        <div className="telemetry-stat">
          <span>Maximum</span>
          <strong>{Math.max(...telemetryData.map((item) => item.temperature))}°C</strong>
        </div>

        <div className="telemetry-stat">
          <span>Minimum</span>
          <strong>{Math.min(...telemetryData.map((item) => item.temperature))}°C</strong>
        </div>
      </div>

      <div className="telemetry-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={telemetryData}>
            <CartesianGrid stroke="#253244" strokeDasharray="3 3" />
            <XAxis dataKey="time" stroke="#8293a7" />
            <YAxis stroke="#8293a7" />
            <Tooltip
              contentStyle={{
                background: "#101b29",
                border: "1px solid #34465c",
                borderRadius: "8px",
                color: "#e8eef7"
              }}
            />
            <Line
              type="monotone"
              dataKey="temperature"
              stroke="#42c9e3"
              strokeWidth={2}
              dot={{ r: 3, fill: "#42c9e3" }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
const initialNodes: Node[] = [
  {
    id: "sensor-1",
    type: "sensor",
    position: { x: 90, y: 150 },
    data: {
      title: "Turbine Sensor",
      subtitle: "temperature · °C",
      accent: "cyan",
      sensorType: "Temperature",
      unit: "°C"
    }
  },
  {
    id: "filter-1",
    type: "filter",
    position: { x: 390, y: 150 },
    data: {
      title: "Moving Average",
      subtitle: "window · 5 samples",
      accent: "violet",
      operation: "Moving Average",
      windowSize: 5
    }
  },
  {
    id: "alert-1",
    type: "alert",
    position: { x: 700, y: 150 },
    data: {
      title: "SMS Alert",
      subtitle: "threshold · 80 °C",
      accent: "orange",
      alertType: "SMS",
      threshold: 80,
      message: "Temperature threshold exceeded!"
    }
  }
];
const initialEdges = [
  { id: "e-sensor-filter", source: "sensor-1", target: "filter-1", animated: true },
  { id: "e-filter-alert", source: "filter-1", target: "alert-1", animated: true }
];

const GRAPH_STORAGE_KEY = "nexusflow-week1-graph";
type SavedGraph = { nodes: Node[]; edges: typeof initialEdges; savedAt?: string };


function readSavedGraph(): SavedGraph | null {
  try {
    const raw = localStorage.getItem(GRAPH_STORAGE_KEY);

    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("nodes" in parsed) ||
      !("edges" in parsed) ||
      !Array.isArray(parsed.nodes) ||
      !Array.isArray(parsed.edges)
    ) {
      return null;
    }

    const nodeIds = new Set<string>();

    const validNodes = parsed.nodes.every((node) => {
      if (
        typeof node !== "object" ||
        node === null ||
        !("id" in node) ||
        typeof node.id !== "string" ||
        !node.id.trim() ||
        nodeIds.has(node.id) ||
        !("position" in node) ||
        typeof node.position !== "object" ||
        node.position === null ||
        !("x" in node.position) ||
        typeof node.position.x !== "number" ||
        !Number.isFinite(node.position.x) ||
        !("y" in node.position) ||
        typeof node.position.y !== "number" ||
        !Number.isFinite(node.position.y) ||
        !("data" in node) ||
        typeof node.data !== "object" ||
        node.data === null
      ) {
        return false;
      }

      nodeIds.add(node.id);
      return true;
    });

    const validEdges = parsed.edges.every(
      (edge) =>
        typeof edge === "object" &&
        edge !== null &&
        "id" in edge &&
        typeof edge.id === "string" &&
        "source" in edge &&
        typeof edge.source === "string" &&
        nodeIds.has(edge.source) &&
        "target" in edge &&
        typeof edge.target === "string" &&
        nodeIds.has(edge.target)
    );

    if (!validNodes || !validEdges) return null;

    return parsed as SavedGraph;
  } catch {
    return null;
  }
}


function Studio() {
  const restoredGraph = useMemo(() => readSavedGraph(), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(restoredGraph?.nodes ?? initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(restoredGraph?.edges ?? initialEdges);
  const [saved, setSaved] = useState(Boolean(restoredGraph));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  const onDragStart = (
    event: React.DragEvent<HTMLButtonElement>,
    nodeType: "sensor" | "filter" | "alert"
  ) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();

    const type = event.dataTransfer.getData("application/reactflow") as
      | "sensor"
      | "filter"
      | "alert";

    if (!["sensor", "filter", "alert"].includes(type)) return;

    const config: Record<string, PipelineNodeData> = {
      sensor: {
        title: "New Sensor",
        subtitle: "temperature · °C",
        accent: "cyan",
        sensorType: "Temperature",
        unit: "°C"
      },
      filter: {
        title: "Math Operation",
        subtitle: "window · 5 samples",
        accent: "violet",
        operation: "Moving Average",
        windowSize: 5
      },
      alert: {
        title: "Action Trigger",
        subtitle: "threshold · 80",
        accent: "orange",
        alertType: "SMS",
        threshold: 80,
        message: "Alert triggered!"
      }
    };

    const position = screenToFlowPosition({
      x: event.clientX,
      y: event.clientY
    });

    setNodes((current) => [
      ...current,
      {
        id: `${type}-${Date.now()}`,
        type,
        position,
        data: config[type]
      }
    ]);

    setSaved(false);
  };
  const [selected, setSelected] = useState("sensor");
  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge({ ...connection, animated: true }, eds));
    setSaved(false);
  }, [setEdges]);
  const counts = useMemo(() => ({ nodes: nodes.length, connections: edges.length }), [nodes.length, edges.length]);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);


  const updateSelectedNode = (
    field: keyof PipelineNodeData,
    value: string | number
  ) => {
    if (!selectedNodeId) return;

    setNodes((current) =>
      current.map((node) => {
        if (node.id !== selectedNodeId) return node;

        const updatedData = {
          ...node.data,
          [field]: value
        } as PipelineNodeData;

        if (node.type === "sensor") {
          updatedData.subtitle =
            `${updatedData.sensorType ?? "Temperature"} · ${updatedData.unit ?? "°C"}`;
        }

        if (node.type === "filter") {
          updatedData.subtitle =
            `${updatedData.operation ?? "Moving Average"} · ${updatedData.windowSize ?? 5} samples`;
        }

        if (node.type === "alert") {
          updatedData.subtitle =
            `threshold · ${updatedData.threshold ?? 80}`;
        }

        return {
          ...node,
          data: updatedData
        };
      })
    );

    setSaved(false);
  };


  const addNode = (type: "sensor" | "filter" | "alert") => {
    const id = `${type}-${Date.now()}`;
    const config: Record<string, PipelineNodeData> = {
      sensor: {
        title: "New Sensor",
        subtitle: "temperature · °C",
        accent: "cyan",
        sensorType: "Temperature",
        unit: "°C"
      },
      filter: {
        title: "Math Operation",
        subtitle: "window · 5 samples",
        accent: "violet",
        operation: "Moving Average",
        windowSize: 5
      },
      alert: {
        title: "Action Trigger",
        subtitle: "threshold · 80",
        accent: "orange",
        alertType: "SMS",
        threshold: 80,
        message: "Alert triggered!"
      }
    };
    setNodes((current) => [...current, { id, type, position: { x: 160 + Math.random() * 260, y: 300 + Math.random() * 160 }, data: config[type] }]);
    setSaved(false);
  };


  const saveGraph = () => {
    try {
      const graph = {
        nodes,
        edges,
        savedAt: new Date().toISOString()
      };

      localStorage.setItem(
        GRAPH_STORAGE_KEY,
        JSON.stringify(graph)
      );

      setSaved(true);
    } catch (error) {
      console.error("Failed to save NexusFlow graph:", error);
      setSaved(false);
      window.alert("Unable to save graph. Please check browser storage.");
    }
  };


  const resetGraph = () => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    localStorage.removeItem(GRAPH_STORAGE_KEY);
    setSaved(false);
  };

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#"><span className="brand-mark"><Workflow size={19} /></span><span>NEXUS<span className="brand-accent">FLOW</span><small>TELEMETRY STUDIO</small></span></a>
      <div className="topbar-center"><span className="live-indicator" /> WORKSPACE <b>/</b> UNTITLED PIPELINE</div>
      <div className="topbar-actions"><span className="draft-label">WEEK 01 · FOUNDATION</span><button className="reset-button" onClick={resetGraph}>Reset starter</button><button className="save-button" onClick={saveGraph}><Save size={15} /> {saved ? "Saved locally" : "Save graph"}</button></div>
    </header>
    <main className="workspace">
      <aside className="sidebar">
        <div className="sidebar-heading">PIPELINE BUILDER <span>01</span></div>
        <p className="sidebar-copy">Build a flow by adding nodes and connecting their ports.</p>
        <div className="palette-label">NODE LIBRARY</div>
        <button
          draggable
          onDragStart={(event) => onDragStart(event, "sensor")}
          className={selected === "sensor" ? "palette-item active" : "palette-item"}
          onClick={() => { setSelected("sensor"); addNode("sensor"); }}
        >
          <span className="palette-icon cyan"><Radio size={17} /></span>
          <span><b>Data source</b><small>Sensor telemetry input</small></span>
          <Plus size={15} />
        </button>
        <button
          draggable
          onDragStart={(event) => onDragStart(event, "filter")}
          className={selected === "filter" ? "palette-item active" : "palette-item"}
          onClick={() => { setSelected("filter"); addNode("filter"); }}
        >
          <span className="palette-icon violet"><Gauge size={17} /></span>
          <span><b>Math & filter</b><small>Transform measurements</small></span>
          <Plus size={15} />
        </button>
        <button
          draggable
          onDragStart={(event) => onDragStart(event, "alert")}
          className={selected === "alert" ? "palette-item active" : "palette-item"}
          onClick={() => { setSelected("alert"); addNode("alert"); }}
        >
          <span className="palette-icon orange"><AlertTriangle size={17} /></span>
          <span><b>Action trigger</b><small>Alerts and actions</small></span>
          <Plus size={15} />
        </button>
        {selectedNode && (
          <div className="node-config">
            <div className="sidebar-divider" />
            <div className="sidebar-heading">
              NODE CONFIGURATION
              <span>EDIT</span>
            </div>

            <p className="sidebar-copy">
              Configure the selected {selectedNode.type} node.
            </p>

            <label className="config-label">Node name</label>
            <input
              className="config-input"
              type="text"
              value={String(selectedNode.data.title ?? "")}
              onChange={(event) =>
                updateSelectedNode("title", event.target.value)
              }
            />

            {selectedNode.type === "sensor" && (
              <>
                <label className="config-label">Sensor type</label>
                <select
                  className="config-input"
                  value={String(selectedNode.data.sensorType ?? "Temperature")}
                  onChange={(event) =>
                    updateSelectedNode("sensorType", event.target.value)
                  }
                >
                  <option value="Temperature">Temperature</option>
                  <option value="Humidity">Humidity</option>
                  <option value="Pressure">Pressure</option>
                </select>

                <label className="config-label">Measurement unit</label>
                <input
                  className="config-input"
                  type="text"
                  value={String(selectedNode.data.unit ?? "")}
                  onChange={(event) =>
                    updateSelectedNode("unit", event.target.value)
                  }
                />
              </>
            )}

            {selectedNode.type === "filter" && (
              <>
                <label className="config-label">Operation</label>
                <select
                  className="config-input"
                  value={String(selectedNode.data.operation ?? "Moving Average")}
                  onChange={(event) =>
                    updateSelectedNode("operation", event.target.value)
                  }
                >
                  <option value="Moving Average">Moving Average</option>
                  <option value="Sum">Sum</option>
                  <option value="Minimum">Minimum</option>
                  <option value="Maximum">Maximum</option>
                </select>

                <label className="config-label">Window size</label>
                <input
                  className="config-input"
                  type="number"
                  min="1"
                  value={Number(selectedNode.data.windowSize ?? 5)}
                  onChange={(event) =>
                    updateSelectedNode("windowSize", Number(event.target.value))
                  }
                />
              </>
            )}

            {selectedNode.type === "alert" && (
              <>
                <label className="config-label">Alert type</label>
                <select
                  className="config-input"
                  value={String(selectedNode.data.alertType ?? "SMS")}
                  onChange={(event) =>
                    updateSelectedNode("alertType", event.target.value)
                  }
                >
                  <option value="SMS">SMS</option>
                  <option value="Email">Email</option>
                  <option value="Webhook">Webhook</option>
                </select>

                <label className="config-label">Threshold</label>
                <input
                  className="config-input"
                  type="number"
                  value={Number(selectedNode.data.threshold ?? 80)}
                  onChange={(event) =>
                    updateSelectedNode("threshold", Number(event.target.value))
                  }
                />

                <label className="config-label">Alert message</label>
                <input
                  className="config-input"
                  type="text"
                  value={String(selectedNode.data.message ?? "")}
                  onChange={(event) =>
                    updateSelectedNode("message", event.target.value)
                  }
                />
              </>
            )}

            <button
              className="reset-button config-close"
              onClick={() => setSelectedNodeId(null)}
            >
              Close configuration
            </button>
          </div>
        )}
        <div className="sidebar-divider" />
        <div className="sidebar-heading">WORKSPACE STATUS</div>
        <div className="status-card"><div><span>Canvas nodes</span><b>{counts.nodes.toString().padStart(2, "0")}</b></div><div><span>Connections</span><b>{counts.connections.toString().padStart(2, "0")}</b></div><div><span>Database</span><b className="offline">Not connected</b></div></div>
        <div className="sidebar-note"><Database size={15} /><span>Week 1 foundation<br /><b>MongoDB setup pending</b></span></div>
      </aside>
      <section className="canvas-section">
        <div className="canvas-toolbar"><div><span className="eyebrow">VISUAL WORKFLOW</span><h1>Pipeline canvas</h1></div><div className="canvas-meta"><span><i className="legend-dot cyan-dot" /> SOURCE</span><span><i className="legend-dot violet-dot" /> PROCESS</span><span><i className="legend-dot orange-dot" /> ACTION</span></div></div>
        <div
          className="flow-wrap"
          onDrop={onDrop}
          onDragOver={onDragOver}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)} deleteKeyCode={["Backspace", "Delete"]} onNodesChange={(changes) => { onNodesChange(changes); setSaved(false); }} onEdgesChange={(changes) => { onEdgesChange(changes); setSaved(false); }} onConnect={onConnect} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.25 }} minZoom={0.25} maxZoom={1.5} proOptions={{ hideAttribution: true }}>
            <Background color="#253244" gap={22} size={1} />
            <Controls />
            <MiniMap nodeColor={(node) => node.type === "sensor" ? "#36c9e8" : node.type === "filter" ? "#9a82f5" : "#f5a45b"} maskColor="rgba(5, 10, 18, 0.72)" />
          </ReactFlow>
          <div className="canvas-hint"><Activity size={14} /> Drag nodes to arrange · Connect ports to create a flow</div>
        </div>

        <TelemetryChart />
        <footer className="canvas-footer"><span><Cpu size={14} /> NEXUSFLOW GRAPH EDITOR</span><span>{counts.nodes} NODES <b>·</b> {counts.connections} EDGES <b>·</b> LOCAL DRAFT</span></footer>
      </section>
    </main>
  </div >;
}

export default function App() {
  return <ReactFlowProvider><Studio /></ReactFlowProvider>;
}
