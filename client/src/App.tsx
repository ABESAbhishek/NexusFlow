import { useCallback, useMemo, useState } from "react";
import {
  Background, Controls, MiniMap, ReactFlow, ReactFlowProvider,
  addEdge, useEdgesState, useNodesState, type Connection, type Node,
  type NodeTypes, Handle, Position
} from "@xyflow/react";
import { Activity, AlertTriangle, Cpu, Database, Gauge, Plus, Radio, Save, Workflow } from "lucide-react";

type PipelineNodeData = { title: string; subtitle: string; accent: string };

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
const initialNodes: Node[] = [
  { id: "sensor-1", type: "sensor", position: { x: 90, y: 150 }, data: { title: "Turbine Sensor", subtitle: "temperature · °C", accent: "cyan" } },
  { id: "filter-1", type: "filter", position: { x: 390, y: 150 }, data: { title: "Moving Average", subtitle: "window · 5 samples", accent: "violet" } },
  { id: "alert-1", type: "alert", position: { x: 700, y: 150 }, data: { title: "SMS Alert", subtitle: "threshold · 80 °C", accent: "orange" } }
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
    const parsed = JSON.parse(raw) as SavedGraph;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function Studio() {
  const restoredGraph = useMemo(() => readSavedGraph(), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(restoredGraph?.nodes ?? initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(restoredGraph?.edges ?? initialEdges);
  const [saved, setSaved] = useState(Boolean(restoredGraph));
  const [selected, setSelected] = useState("sensor");
  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge({ ...connection, animated: true }, eds));
    setSaved(false);
  }, [setEdges]);
  const counts = useMemo(() => ({ nodes: nodes.length, connections: edges.length }), [nodes.length, edges.length]);

  const addNode = (type: "sensor" | "filter" | "alert") => {
    const id = `${type}-${Date.now()}`;
    const config: Record<string, PipelineNodeData> = {
      sensor: { title: "New Sensor", subtitle: "telemetry source", accent: "cyan" },
      filter: { title: "Math Operation", subtitle: "configure expression", accent: "violet" },
      alert: { title: "Action Trigger", subtitle: "configure action", accent: "orange" }
    };
    setNodes((current) => [...current, { id, type, position: { x: 160 + Math.random() * 260, y: 300 + Math.random() * 160 }, data: config[type] }]);
    setSaved(false);
  };

  const saveGraph = () => {
    const graph = { nodes, edges, savedAt: new Date().toISOString() };
    localStorage.setItem(GRAPH_STORAGE_KEY, JSON.stringify(graph));
    setSaved(true);
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
        <button className={selected === "sensor" ? "palette-item active" : "palette-item"} onClick={() => { setSelected("sensor"); addNode("sensor"); }}><span className="palette-icon cyan"><Radio size={17} /></span><span><b>Data source</b><small>Sensor telemetry input</small></span><Plus size={15} /></button>
        <button className={selected === "filter" ? "palette-item active" : "palette-item"} onClick={() => { setSelected("filter"); addNode("filter"); }}><span className="palette-icon violet"><Gauge size={17} /></span><span><b>Math & filter</b><small>Transform measurements</small></span><Plus size={15} /></button>
        <button className={selected === "alert" ? "palette-item active" : "palette-item"} onClick={() => { setSelected("alert"); addNode("alert"); }}><span className="palette-icon orange"><AlertTriangle size={17} /></span><span><b>Action trigger</b><small>Alerts and actions</small></span><Plus size={15} /></button>
        <div className="sidebar-divider" />
        <div className="sidebar-heading">WORKSPACE STATUS</div>
        <div className="status-card"><div><span>Canvas nodes</span><b>{counts.nodes.toString().padStart(2, "0")}</b></div><div><span>Connections</span><b>{counts.connections.toString().padStart(2, "0")}</b></div><div><span>Database</span><b className="offline">Not connected</b></div></div>
        <div className="sidebar-note"><Database size={15} /><span>Week 1 foundation<br /><b>MongoDB setup pending</b></span></div>
      </aside>
      <section className="canvas-section">
        <div className="canvas-toolbar"><div><span className="eyebrow">VISUAL WORKFLOW</span><h1>Pipeline canvas</h1></div><div className="canvas-meta"><span><i className="legend-dot cyan-dot" /> SOURCE</span><span><i className="legend-dot violet-dot" /> PROCESS</span><span><i className="legend-dot orange-dot" /> ACTION</span></div></div>
        <div className="flow-wrap">
          <ReactFlow nodes={nodes} edges={edges} deleteKeyCode={["Backspace", "Delete"]} onNodesChange={(changes) => { onNodesChange(changes); setSaved(false); }} onEdgesChange={(changes) => { onEdgesChange(changes); setSaved(false); }} onConnect={onConnect} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.25 }} minZoom={0.25} maxZoom={1.5} proOptions={{ hideAttribution: true }}>
            <Background color="#253244" gap={22} size={1} />
            <Controls />
            <MiniMap nodeColor={(node) => node.type === "sensor" ? "#36c9e8" : node.type === "filter" ? "#9a82f5" : "#f5a45b"} maskColor="rgba(5, 10, 18, 0.72)" />
          </ReactFlow>
          <div className="canvas-hint"><Activity size={14} /> Drag nodes to arrange · Connect ports to create a flow</div>
        </div>
        <footer className="canvas-footer"><span><Cpu size={14} /> NEXUSFLOW GRAPH EDITOR</span><span>{counts.nodes} NODES <b>·</b> {counts.connections} EDGES <b>·</b> LOCAL DRAFT</span></footer>
      </section>
    </main>
  </div>;
}

export default function App() {
  return <ReactFlowProvider><Studio /></ReactFlowProvider>;
}
