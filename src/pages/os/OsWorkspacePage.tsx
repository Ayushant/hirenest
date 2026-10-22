import React, { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Boxes,
  Building2,
  CheckCircle2,
  ChevronRight,
  Cpu,
  DollarSign,
  Filter,
  GitBranch,
  Grid,
  Layers,
  Maximize2,
  Minimize2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sliders,
  Sparkles,
  Square,
  Terminal,
  TrendingUp,
  Truck,
  Users,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { supabase } from '../../lib/supabase';

// ============================================================================
// TYPES & REALISTIC ENTERPRISE ERP + CRM + OS TELEMETRY DATA
// ============================================================================

type NavSection =
  | 'crm_leads'
  | 'crm_pipeline'
  | 'crm_customers'
  | 'erp_inventory'
  | 'erp_supply_chain'
  | 'erp_finance';

type WindowId = 'finance_chart' | 'customer_profiles' | 'workflow_graph' | 'erp_supply';

interface WindowState {
  id: WindowId;
  title: string;
  subtitle: string;
  category: 'ERP · FINANCE' | 'CRM · PROFILES' | 'OS · AUTOMATION' | 'ERP · SUPPLY CHAIN';
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  zIndex: number;
  // Position in overlapping OS window mode
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FinanceNodePoint {
  id: string;
  label: string;
  timestamp: string;
  revenueK: number;
  marginPct: number;
  erpBurnK: number;
  activeDeals: number;
  supplyVelocity: number;
  annotation: string;
}

interface CustomerProfileRecord {
  id: string;
  code: string;
  company: string;
  contactName: string;
  contactRole: string;
  segment: 'Enterprise' | 'Mid-Market' | 'Strategic';
  stage: 'Qualified Lead' | 'Active Contract' | 'Expansion' | 'At Risk';
  arrValue: number;
  healthScore: number;
  erpSkuAllocation: string;
  fulfillmentSla: string;
  region: string;
  lastTouch: string;
}

interface WorkflowNodeItem {
  id: string;
  title: string;
  type: 'TRIGGER' | 'ERP_CHECK' | 'CRM_ROUTER' | 'FULFILLMENT' | 'LEDGER_SYNC';
  subtitle: string;
  latencyMs: number;
  successRate: string;
  status: 'healthy' | 'running' | 'warning';
  x: number;
  y: number;
  inputs: string[];
  outputs: string[];
  ruleSummary: string;
  samplePayload: string;
}

interface ErpInventoryItem {
  sku: string;
  name: string;
  category: 'Compute Cluster' | 'Hardware Kit' | 'Field Workforce' | 'Edge Node';
  warehouse: string;
  allocated: number;
  available: number;
  reorderPoint: number;
  unitCost: number;
  transitEta: string;
  status: 'Optimal' | 'Low Stock' | 'In Transit';
}

const FINANCE_SERIES: Record<'24H' | '7D' | '30D' | 'QTD' | 'YTD', FinanceNodePoint[]> = {
  '24H': [
    { id: 'f1', label: '00:00', timestamp: '00:00 UTC', revenueK: 412, marginPct: 68.4, erpBurnK: 130, activeDeals: 44, supplyVelocity: 94, annotation: 'APAC ledger batch settled' },
    { id: 'f2', label: '04:00', timestamp: '04:00 UTC', revenueK: 438, marginPct: 70.1, erpBurnK: 128, activeDeals: 47, supplyVelocity: 95, annotation: 'Automated invoice reconciliation' },
    { id: 'f3', label: '08:00', timestamp: '08:00 UTC', revenueK: 489, marginPct: 72.3, erpBurnK: 135, activeDeals: 53, supplyVelocity: 96, annotation: 'EMEA enterprise renewal closed' },
    { id: 'f4', label: '12:00', timestamp: '12:00 UTC', revenueK: 472, marginPct: 71.0, erpBurnK: 137, activeDeals: 55, supplyVelocity: 93, annotation: 'Frankfurt warehouse restock allocation' },
    { id: 'f5', label: '16:00', timestamp: '16:00 UTC', revenueK: 534, marginPct: 74.8, erpBurnK: 134, activeDeals: 62, supplyVelocity: 98, annotation: 'US-East multi-year SLA expansion' },
    { id: 'f6', label: '20:00', timestamp: '20:00 UTC', revenueK: 568, marginPct: 76.2, erpBurnK: 132, activeDeals: 66, supplyVelocity: 99, annotation: 'Q4 enterprise contract milestone' },
    { id: 'f7', label: 'NOW', timestamp: 'Live Telemetry', revenueK: 614, marginPct: 78.5, erpBurnK: 131, activeDeals: 71, supplyVelocity: 99, annotation: 'Real-time ERP + CRM sync active' },
  ],
  '7D': [
    { id: 'd1', label: 'Mon', timestamp: 'Oct 16', revenueK: 2840, marginPct: 69.2, erpBurnK: 890, activeDeals: 112, supplyVelocity: 92, annotation: 'Weekly sprint kickoff & SKU lock' },
    { id: 'd2', label: 'Tue', timestamp: 'Oct 17', revenueK: 3010, marginPct: 70.8, erpBurnK: 880, activeDeals: 118, supplyVelocity: 94, annotation: 'FinCore tier-1 CRM conversion' },
    { id: 'd3', label: 'Wed', timestamp: 'Oct 18', revenueK: 2950, marginPct: 70.1, erpBurnK: 895, activeDeals: 121, supplyVelocity: 93, annotation: 'Supply chain customs clearance' },
    { id: 'd4', label: 'Thu', timestamp: 'Oct 19', revenueK: 3390, marginPct: 73.4, erpBurnK: 902, activeDeals: 129, supplyVelocity: 96, annotation: 'Automated billing workflow spike' },
    { id: 'd5', label: 'Fri', timestamp: 'Oct 20', revenueK: 3680, marginPct: 75.0, erpBurnK: 910, activeDeals: 136, supplyVelocity: 97, annotation: '3 strategic enterprise sign-offs' },
    { id: 'd6', label: 'Sat', timestamp: 'Oct 21', revenueK: 3790, marginPct: 76.1, erpBurnK: 870, activeDeals: 138, supplyVelocity: 98, annotation: 'Autonomous self-serve upgrades' },
    { id: 'd7', label: 'Sun', timestamp: 'Oct 22', revenueK: 4120, marginPct: 78.5, erpBurnK: 865, activeDeals: 145, supplyVelocity: 99, annotation: 'Weekly high watermark reached' },
  ],
  '30D': [
    { id: 'm1', label: 'W1', timestamp: 'Week 1', revenueK: 11200, marginPct: 68.0, erpBurnK: 3600, activeDeals: 180, supplyVelocity: 91, annotation: 'Baseline monthly opening' },
    { id: 'm2', label: 'W2', timestamp: 'Week 2', revenueK: 12450, marginPct: 71.2, erpBurnK: 3550, activeDeals: 196, supplyVelocity: 94, annotation: 'CRM outbound sequence lift' },
    { id: 'm3', label: 'W3', timestamp: 'Week 3', revenueK: 13890, marginPct: 74.5, erpBurnK: 3510, activeDeals: 215, supplyVelocity: 97, annotation: 'ERP automated procurement cut cost 8%' },
    { id: 'm4', label: 'W4', timestamp: 'Week 4', revenueK: 15640, marginPct: 78.5, erpBurnK: 3420, activeDeals: 238, supplyVelocity: 99, annotation: 'Record net retention 134%' },
  ],
  'QTD': [
    { id: 'q1', label: 'Jul', timestamp: 'July', revenueK: 38400, marginPct: 70.4, erpBurnK: 11200, activeDeals: 310, supplyVelocity: 93, annotation: 'Q3 opening run-rate' },
    { id: 'q2', label: 'Aug', timestamp: 'August', revenueK: 42900, marginPct: 73.8, erpBurnK: 10950, activeDeals: 342, supplyVelocity: 96, annotation: 'European supply hub online' },
    { id: 'q3', label: 'Sep', timestamp: 'September', revenueK: 48700, marginPct: 76.2, erpBurnK: 10800, activeDeals: 389, supplyVelocity: 98, annotation: 'Enterprise CRM expansion wave' },
    { id: 'q4', label: 'Oct', timestamp: 'October (Live)', revenueK: 54200, marginPct: 78.5, erpBurnK: 10600, activeDeals: 428, supplyVelocity: 99, annotation: 'Current Q4 pace +24% YoY' },
  ],
  'YTD': [
    { id: 'y1', label: 'Q1', timestamp: 'FY26 Q1', revenueK: 108000, marginPct: 67.5, erpBurnK: 35000, activeDeals: 290, supplyVelocity: 90, annotation: 'Q1 foundation' },
    { id: 'y2', label: 'Q2', timestamp: 'FY26 Q2', revenueK: 129500, marginPct: 71.9, erpBurnK: 33800, activeDeals: 345, supplyVelocity: 94, annotation: 'Q2 workflow automation launch' },
    { id: 'y3', label: 'Q3', timestamp: 'FY26 Q3', revenueK: 154200, marginPct: 75.4, erpBurnK: 32900, activeDeals: 398, supplyVelocity: 97, annotation: 'Q3 global ERP unification' },
    { id: 'y4', label: 'Q4', timestamp: 'FY26 Q4 (Est)', revenueK: 182600, marginPct: 78.5, erpBurnK: 31800, activeDeals: 462, supplyVelocity: 99, annotation: 'Q4 live trajectory' },
  ],
};

const INITIAL_CUSTOMERS: CustomerProfileRecord[] = [
  {
    id: 'cust-01',
    code: 'CRM-8841',
    company: 'Aetherion Cloud Systems',
    contactName: 'Elena Rostova',
    contactRole: 'VP Infrastructure',
    segment: 'Strategic',
    stage: 'Active Contract',
    arrValue: 1480000,
    healthScore: 96,
    erpSkuAllocation: '42x H200 Rack Nodes · Committed',
    fulfillmentSla: '99.98% On-Time',
    region: 'US-East · Virginia',
    lastTouch: '14m ago',
  },
  {
    id: 'cust-02',
    code: 'CRM-8842',
    company: 'Kinetix Robotics Group',
    contactName: 'Marcus Vance',
    contactRole: 'Chief Operating Officer',
    segment: 'Enterprise',
    stage: 'Expansion',
    arrValue: 920000,
    healthScore: 92,
    erpSkuAllocation: '128x Edge Telemetry Kits · Staged',
    fulfillmentSla: '99.40% On-Time',
    region: 'EU-Central · Frankfurt',
    lastTouch: '38m ago',
  },
  {
    id: 'cust-03',
    code: 'CRM-8843',
    company: 'Veridian BioLabs',
    contactName: 'Dr. Soren Lindqvist',
    contactRole: 'Head of Compute Procurement',
    segment: 'Enterprise',
    stage: 'Qualified Lead',
    arrValue: 640000,
    healthScore: 85,
    erpSkuAllocation: '18x Cryo-Sensor Arrays · Hold',
    fulfillmentSla: 'Pending Credit Gate',
    region: 'EU-North · Stockholm',
    lastTouch: '1h ago',
  },
  {
    id: 'cust-04',
    code: 'CRM-8844',
    company: 'Vanguard Logistics Corp',
    contactName: 'Takashi Sato',
    contactRole: 'SVP Global Supply Chain',
    segment: 'Strategic',
    stage: 'Active Contract',
    arrValue: 2150000,
    healthScore: 98,
    erpSkuAllocation: '310x Autonomous Fleet Units',
    fulfillmentSla: '100.0% On-Time',
    region: 'APAC · Tokyo',
    lastTouch: '2h ago',
  },
  {
    id: 'cust-05',
    code: 'CRM-8845',
    company: 'Helios Energy Grid',
    contactName: 'amara.okafor@helios.io',
    contactRole: 'Director of Grid Ops',
    segment: 'Mid-Market',
    stage: 'At Risk',
    arrValue: 410000,
    healthScore: 61,
    erpSkuAllocation: '12x Substation Gateways · Delayed',
    fulfillmentSla: '94.20% · Customs Hold',
    region: 'US-West · Oregon',
    lastTouch: '3h ago',
  },
  {
    id: 'cust-06',
    code: 'CRM-8846',
    company: 'Novus Quantitative',
    contactName: 'Julian Mercer',
    contactRole: 'Managing Partner',
    segment: 'Strategic',
    stage: 'Expansion',
    arrValue: 1790000,
    healthScore: 95,
    erpSkuAllocation: '64x Ultra-Low-Latency Blades',
    fulfillmentSla: '99.95% On-Time',
    region: 'UK · London LD4',
    lastTouch: '5h ago',
  },
];

const WORKFLOW_NODES: WorkflowNodeItem[] = [
  {
    id: 'node-1',
    title: 'CRM Lead & Order Ingest',
    type: 'TRIGGER',
    subtitle: 'Webhook + Salesforce / HubSpot + Portal',
    latencyMs: 18,
    successRate: '99.99%',
    status: 'healthy',
    x: 28,
    y: 78,
    inputs: ['HTTPS Event Stream'],
    outputs: ['Normalized Deal Spec'],
    ruleSummary: 'Validates schema, deduplicates account domain, enriches firmographics.',
    samplePayload: `{ "event": "deal.qualified", "account": "Aetherion Cloud", "arr_usd": 1480000, "sku_req": "H200-RACK-42" }`,
  },
  {
    id: 'node-2',
    title: 'ERP Inventory & Credit Gate',
    type: 'ERP_CHECK',
    subtitle: 'Warehouse SKU Lock + Net-30 Risk Score',
    latencyMs: 42,
    successRate: '99.84%',
    status: 'healthy',
    x: 268,
    y: 28,
    inputs: ['Normalized Deal Spec'],
    outputs: ['SKU Reservation Token', 'Credit Cleared'],
    ruleSummary: 'Queries regional warehouses (US-East, EU-Central, APAC) and locks available units.',
    samplePayload: `{ "warehouse": "US-EAST-VA2", "sku_available": 58, "reserved": 42, "credit_tier": "AAA_APPROVED" }`,
  },
  {
    id: 'node-3',
    title: 'Pipeline Deal Desk Router',
    type: 'CRM_ROUTER',
    subtitle: 'Margin Floor >= 68% · SLA Tier Assignment',
    latencyMs: 31,
    successRate: '99.92%',
    status: 'running',
    x: 268,
    y: 142,
    inputs: ['Normalized Deal Spec'],
    outputs: ['Approved Quote Contract'],
    ruleSummary: 'Computes gross margin against BOM cost and routes custom discounts >15% to VP Finance.',
    samplePayload: `{ "gross_margin_pct": 76.4, "auto_approve": true, "sla_tier": "MISSION_CRITICAL_24_7" }`,
  },
  {
    id: 'node-4',
    title: 'Supply Chain Dispatch',
    type: 'FULFILLMENT',
    subtitle: 'Automated Pick-Pack + Freight Telemetry',
    latencyMs: 64,
    successRate: '99.60%',
    status: 'healthy',
    x: 515,
    y: 48,
    inputs: ['SKU Reservation Token', 'Approved Quote Contract'],
    outputs: ['Waybill & ASN Stream'],
    ruleSummary: 'Dispatches fulfillment manifest to 3PL robotics and binds live GPS container tracking.',
    samplePayload: `{ "manifest_id": "SHP-90412", "carrier": "DHL-Express-Air", "eta_hours": 18, "temp_controlled": true }`,
  },
  {
    id: 'node-5',
    title: 'ERP Finance Ledger Sync',
    type: 'LEDGER_SYNC',
    subtitle: 'ASC-606 Revenue Recognition + Invoice',
    latencyMs: 27,
    successRate: '100.0%',
    status: 'healthy',
    x: 515,
    y: 152,
    inputs: ['Credit Cleared', 'Waybill & ASN Stream'],
    outputs: ['GL Journal Entry #88210'],
    ruleSummary: 'Posts double-entry journal to General Ledger, triggers Stripe/ACH wire invoice, updates ARR chart.',
    samplePayload: `{ "gl_account": "4000-ARR-ENT", "recognized_usd": 123333.33, "deferred_usd": 1356666.67, "status": "POSTED" }`,
  },
];

const INITIAL_INVENTORY: ErpInventoryItem[] = [
  {
    sku: 'ERP-SKU-901',
    name: 'H200 Tensor Compute Rack (8x Node)',
    category: 'Compute Cluster',
    warehouse: 'US-East · Ashburn VA',
    allocated: 42,
    available: 16,
    reorderPoint: 15,
    unitCost: 34500,
    transitEta: 'Ready to ship',
    status: 'Optimal',
  },
  {
    sku: 'ERP-SKU-904',
    name: 'Edge Telemetry Gateway v4.2',
    category: 'Edge Node',
    warehouse: 'EU-Central · Frankfurt',
    allocated: 128,
    available: 9,
    reorderPoint: 25,
    unitCost: 2800,
    transitEta: '+40 units in 14h',
    status: 'Low Stock',
  },
  {
    sku: 'ERP-SKU-909',
    name: 'Autonomous Warehouse AMR Unit',
    category: 'Hardware Kit',
    warehouse: 'APAC · Tokyo Narita',
    allocated: 310,
    available: 64,
    reorderPoint: 40,
    unitCost: 11200,
    transitEta: 'Ready to ship',
    status: 'Optimal',
  },
  {
    sku: 'ERP-SKU-915',
    name: 'Dedicated Field Deployment Engineers',
    category: 'Field Workforce',
    warehouse: 'Global Dispatch Pool',
    allocated: 84,
    available: 22,
    reorderPoint: 15,
    unitCost: 4500,
    transitEta: 'On-call 24/7',
    status: 'Optimal',
  },
];

const DEFAULT_WINDOWS: WindowState[] = [
  {
    id: 'finance_chart',
    title: 'ERP Financial Telemetry & Cashflow',
    subtitle: 'Live ARR, Gross Margin & Burn Rate Node Stream',
    category: 'ERP · FINANCE',
    isOpen: true,
    isMinimized: false,
    isMaximized: false,
    zIndex: 30,
    x: 16,
    y: 16,
    w: 580,
    h: 370,
  },
  {
    id: 'workflow_graph',
    title: 'Autonomous CRM → ERP Workflow Graph',
    subtitle: 'Event-Driven Pipeline & Ledger Orchestration',
    category: 'OS · AUTOMATION',
    isOpen: true,
    isMinimized: false,
    isMaximized: false,
    zIndex: 31,
    x: 540,
    y: 28,
    w: 610,
    h: 370,
  },
  {
    id: 'customer_profiles',
    title: 'Customer 360 Profiles & Deal Pipeline',
    subtitle: 'CRM Accounts, Contract ARR & SKU Fulfillment Matrix',
    category: 'CRM · PROFILES',
    isOpen: true,
    isMinimized: false,
    isMaximized: false,
    zIndex: 32,
    x: 28,
    y: 350,
    w: 710,
    h: 360,
  },
  {
    id: 'erp_supply',
    title: 'Global Inventory & Supply Chain SLA',
    subtitle: 'Warehouse Stock, Reorder Triggers & Freight Corridors',
    category: 'ERP · SUPPLY CHAIN',
    isOpen: true,
    isMinimized: false,
    isMaximized: false,
    zIndex: 29,
    x: 690,
    y: 360,
    w: 460,
    h: 350,
  },
];

// ============================================================================
// MAIN OS WORKSPACE COMPONENT
// ============================================================================

export const OsWorkspacePage: React.FC = () => {
  const { session, profile, homeRoute } = useAuth();

  // Window Management Mode: 'tiled' (clean organized 4K grid) or 'overlapping' (OS floating translucent glassmorphic windows)
  const [windowMode, setWindowMode] = useState<'tiled' | 'overlapping'>('overlapping');
  const [activeNav, setActiveNav] = useState<NavSection>('crm_pipeline');
  const [windows, setWindows] = useState<WindowState[]>(DEFAULT_WINDOWS);
  const [focusedWindow, setFocusedWindow] = useState<WindowId>('customer_profiles');

  // Dragging state for Overlapping OS mode
  const [dragging, setDragging] = useState<{
    id: WindowId;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  // Window 1: Financial Chart state
  const [timeframe, setTimeframe] = useState<'24H' | '7D' | '30D' | 'QTD' | 'YTD'>('24H');
  const [selectedPointIdx, setSelectedPointIdx] = useState<number>(6);
  const [showMarginOverlay, setShowMarginOverlay] = useState<boolean>(true);
  const [livePulse, setLivePulse] = useState<boolean>(true);
  const [liveRevenueDelta, setLiveRevenueDelta] = useState<number>(0);

  // Window 2: Customer Profiles state
  const [customerSearch, setCustomerSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('ALL');
  const [customers, setCustomers] = useState<CustomerProfileRecord[]>(INITIAL_CUSTOMERS);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('cust-01');
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [newLeadCompany, setNewLeadCompany] = useState('');
  const [newLeadContact, setNewLeadContact] = useState('');
  const [newLeadArr, setNewLeadArr] = useState('850000');

  // Window 3: Workflow Node Graph state
  const [selectedNodeId, setSelectedNodeId] = useState<string>('node-3');
  const [workflowRunning, setWorkflowRunning] = useState<boolean>(false);
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [workflowExecCount, setWorkflowExecCount] = useState<number>(14289);

  // Window 4: ERP Inventory state
  const [inventory, setInventory] = useState<ErpInventoryItem[]>(INITIAL_INVENTORY);

  // Optional bridge to real Supabase data when signed in
  const { data: liveOrgsCount } = useQuery({
    queryKey: ['os_live_orgs_count', session?.user?.id],
    queryFn: async () => {
      const { count } = await supabase
        .from('organizations')
        .select('id', { count: 'exact', head: true });
      return count ?? 0;
    },
    enabled: Boolean(session?.user?.id),
  });

  // Live subtle telemetry ticker when livePulse is enabled
  useEffect(() => {
    if (!livePulse) return;
    const interval = setInterval(() => {
      setLiveRevenueDelta((prev) => {
        const step = Math.floor(Math.random() * 7) - 2;
        return Math.max(-15, Math.min(45, prev + step));
      });
    }, 3200);
    return () => clearInterval(interval);
  }, [livePulse]);

  // Handle mouse move for OS window dragging
  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - dragging.startX;
      const dy = e.clientY - dragging.startY;
      setWindows((prev) =>
        prev.map((w) =>
          w.id === dragging.id
            ? {
                ...w,
                x: Math.max(0, Math.min(820, dragging.origX + dx)),
                y: Math.max(0, Math.min(520, dragging.origY + dy)),
              }
            : w
        )
      );
    };
    const handleUp = () => setDragging(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging]);

  // Focus & bring window to front
  const focusWindow = (id: WindowId) => {
    setFocusedWindow(id);
    setWindows((prev) => {
      const maxZ = Math.max(...prev.map((w) => w.zIndex), 30);
      return prev.map((w) =>
        w.id === id ? { ...w, isOpen: true, isMinimized: false, zIndex: maxZ + 1 } : w
      );
    });
  };

  const toggleMinimizeWindow = (id: WindowId) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, isMinimized: !w.isMinimized, isMaximized: false } : w))
    );
  };

  const toggleMaximizeWindow = (id: WindowId) => {
    focusWindow(id);
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, isMaximized: !w.isMaximized, isMinimized: false } : w))
    );
  };

  const closeWindow = (id: WindowId) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, isOpen: false, isMaximized: false } : w))
    );
  };

  const resetAllWindows = () => {
    setWindows(DEFAULT_WINDOWS);
    setFocusedWindow('customer_profiles');
  };

  const cascadeWindows = () => {
    setWindowMode('overlapping');
    setWindows((prev) =>
      prev.map((w, idx) => ({
        ...w,
        isOpen: true,
        isMinimized: false,
        isMaximized: false,
        x: 32 + idx * 64,
        y: 24 + idx * 54,
        w: 680,
        h: 390,
        zIndex: 30 + idx,
      }))
    );
  };

  // Sidebar navigation selects & focuses relevant window
  const handleSidebarSelect = (section: NavSection) => {
    setActiveNav(section);
    if (section === 'crm_leads' || section === 'crm_pipeline' || section === 'crm_customers') {
      if (section === 'crm_leads') setStageFilter('Qualified Lead');
      else if (section === 'crm_pipeline') setStageFilter('ALL');
      focusWindow('customer_profiles');
    } else if (section === 'erp_finance') {
      focusWindow('finance_chart');
    } else if (section === 'erp_inventory' || section === 'erp_supply_chain') {
      focusWindow('erp_supply');
    }
  };

  // Trigger simulated workflow execution across the 5 nodes
  const triggerWorkflowRun = () => {
    if (workflowRunning) return;
    setWorkflowRunning(true);
    setActiveStepIndex(0);
    [0, 1, 2, 3, 4].forEach((stepIdx) => {
      setTimeout(() => {
        setActiveStepIndex(stepIdx);
        setSelectedNodeId(WORKFLOW_NODES[stepIdx].id);
      }, stepIdx * 480);
    });
    setTimeout(() => {
      setWorkflowRunning(false);
      setActiveStepIndex(null);
      setWorkflowExecCount((c) => c + 1);
    }, 2600);
  };

  // Restock SKU action in ERP window
  const handleRestockSku = (sku: string) => {
    setInventory((prev) =>
      prev.map((item) =>
        item.sku === sku
          ? {
              ...item,
              available: item.available + 50,
              status: 'Optimal',
              transitEta: 'Restocked via Automated PO',
            }
          : item
      )
    );
  };

  // Add new CRM lead action
  const handleCreateLead = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeadCompany.trim()) return;
    const newRecord: CustomerProfileRecord = {
      id: `cust-${Date.now()}`,
      code: `CRM-${Math.floor(8850 + Math.random() * 140)}`,
      company: newLeadCompany.trim(),
      contactName: newLeadContact.trim() || 'VP Enterprise Ops',
      contactRole: 'Decision Maker',
      segment: 'Enterprise',
      stage: 'Qualified Lead',
      arrValue: Number(newLeadArr) || 750000,
      healthScore: 89,
      erpSkuAllocation: '24x H200 Rack Nodes · Auto-Reserved',
      fulfillmentSla: '99.90%Target',
      region: 'US-East · Virginia',
      lastTouch: 'Just now',
    };
    setCustomers((prev) => [newRecord, ...prev]);
    setSelectedCustomerId(newRecord.id);
    setNewLeadCompany('');
    setNewLeadContact('');
    setShowNewLeadModal(false);
    triggerWorkflowRun();
  };

  // Chart calculations
  const chartPoints = useMemo(() => {
    const base = FINANCE_SERIES[timeframe] || FINANCE_SERIES['24H'];
    return base.map((pt, idx) =>
      idx === base.length - 1
        ? { ...pt, revenueK: Math.max(100, pt.revenueK + liveRevenueDelta) }
        : pt
    );
  }, [timeframe, liveRevenueDelta]);

  const activePoint =
    chartPoints[Math.min(selectedPointIdx, chartPoints.length - 1)] || chartPoints[0];

  const svgCoords = useMemo(() => {
    const width = 520;
    const height = 165;
    const padX = 24;
    const padY = 18;
    const vals = chartPoints.map((p) => p.revenueK);
    const minV = Math.min(...vals) * 0.9;
    const maxV = Math.max(...vals) * 1.06;

    return chartPoints.map((pt, i) => {
      const x =
        padX + (i / Math.max(1, chartPoints.length - 1)) * (width - padX * 2);
      const y =
        height -
        padY -
        ((pt.revenueK - minV) / Math.max(1, maxV - minV)) * (height - padY * 2);
      const marginY =
        height -
        padY -
        ((pt.marginPct - 55) / 30) * (height - padY * 2);
      return { ...pt, x, y, marginY, index: i };
    });
  }, [chartPoints]);

  const linePath = useMemo(
    () =>
      svgCoords
        .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
        .join(' '),
    [svgCoords]
  );

  const areaPath = useMemo(() => {
    if (!svgCoords.length) return '';
    const first = svgCoords[0];
    const last = svgCoords[svgCoords.length - 1];
    return `${linePath} L ${last.x.toFixed(1)} 155 L ${first.x.toFixed(1)} 155 Z`;
  }, [svgCoords, linePath]);

  const marginLinePath = useMemo(
    () =>
      svgCoords
        .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.marginY.toFixed(1)}`)
        .join(' '),
    [svgCoords]
  );

  // Filtered customers
  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      const matchesStage = stageFilter === 'ALL' || c.stage === stageFilter;
      const q = customerSearch.trim().toLowerCase();
      const matchesQuery =
        !q ||
        c.company.toLowerCase().includes(q) ||
        c.contactName.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.erpSkuAllocation.toLowerCase().includes(q);
      return matchesStage && matchesQuery;
    });
  }, [customers, stageFilter, customerSearch]);

  const selectedCustomer =
    customers.find((c) => c.id === selectedCustomerId) || filteredCustomers[0] || customers[0];

  const selectedWorkflowNode =
    WORKFLOW_NODES.find((n) => n.id === selectedNodeId) || WORKFLOW_NODES[0];

  const totalArr = useMemo(
    () => customers.reduce((acc, item) => acc + item.arrValue, 0),
    [customers]
  );

  const maximizedWin = windows.find((w) => w.isOpen && !w.isMinimized && w.isMaximized);

  // Helper to render window chrome header
  const renderWindowHeader = (win: WindowState, extraRight?: React.ReactNode) => {
    const isFocused = focusedWindow === win.id;
    return (
      <div
        onMouseDown={(e) => {
          focusWindow(win.id);
          if (windowMode === 'overlapping' && !win.isMaximized) {
            setDragging({
              id: win.id,
              startX: e.clientX,
              startY: e.clientY,
              origX: win.x,
              origY: win.y,
            });
          }
        }}
        className={`h-9 px-3.5 flex items-center justify-between border-b select-none ${
          windowMode === 'overlapping' && !win.isMaximized ? 'cursor-move' : 'cursor-default'
        } ${
          isFocused
            ? 'bg-[#0F172A]/95 border-[#38BDF8]/30'
            : 'bg-[#0B0F19]/90 border-slate-800/80'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {/* OS Window Control Dots */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                closeWindow(win.id);
              }}
              title="Close window"
              className="h-2.5 w-2.5 rounded-full bg-slate-700 hover:bg-rose-500 transition-colors cursor-pointer"
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleMinimizeWindow(win.id);
              }}
              title="Minimize to dock"
              className="h-2.5 w-2.5 rounded-full bg-slate-700 hover:bg-amber-400 transition-colors cursor-pointer"
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleMaximizeWindow(win.id);
              }}
              title="Maximize window"
              className="h-2.5 w-2.5 rounded-full bg-slate-700 hover:bg-[#38BDF8] transition-colors cursor-pointer"
            />
          </div>

          <span className="font-mono text-[10px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded bg-[#38BDF8]/10 text-[#38BDF8] border border-[#38BDF8]/25 shrink-0">
            {win.category}
          </span>
          <span className="text-[12px] font-semibold text-slate-100 truncate">
            {win.title}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {extraRight}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleMaximizeWindow(win.id);
            }}
            className="text-slate-400 hover:text-slate-100 p-1 rounded hover:bg-slate-800/70 cursor-pointer"
            title={win.isMaximized ? 'Restore size' : 'Maximize'}
          >
            {win.isMaximized ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    );
  };

  // ============================================================================
  // RENDER INDIVIDUAL OS WIDGET CONTENTS
  // ============================================================================

  const renderFinanceWindowContent = () => (
    <div className="p-4 flex flex-col justify-between h-[calc(100%-36px)] bg-[#0B0F17]/85">
      {/* Top KPI + Timeframe Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-5">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.06em] text-slate-400">
              Active Node Revenue ({activePoint.timestamp})
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="font-mono tabular-nums text-[22px] font-semibold text-white">
                ${activePoint.revenueK.toLocaleString()}K
              </span>
              <span className="font-mono text-[11px] text-emerald-400 flex items-center gap-0.5">
                <ArrowUpRight className="h-3 w-3" />
                +18.4%
              </span>
            </div>
          </div>

          <div className="pl-4 border-l border-slate-800">
            <div className="text-[10px] font-mono uppercase tracking-[0.06em] text-slate-400">
              Gross Margin
            </div>
            <div className="font-mono tabular-nums text-[15px] font-semibold text-[#38BDF8] mt-0.5">
              {activePoint.marginPct.toFixed(1)}%
            </div>
          </div>

          <div className="pl-4 border-l border-slate-800 hidden sm:block">
            <div className="text-[10px] font-mono uppercase tracking-[0.06em] text-slate-400">
              ERP Fulfillment SLA
            </div>
            <div className="font-mono tabular-nums text-[15px] font-semibold text-slate-200 mt-0.5">
              {activePoint.supplyVelocity}%
            </div>
          </div>
        </div>

        {/* Timeframe Switcher */}
        <div className="flex items-center gap-1 bg-slate-900/90 p-0.5 rounded-[6px] border border-slate-800">
          {(['24H', '7D', '30D', 'QTD', 'YTD'] as const).map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => {
                setTimeframe(tf);
                setSelectedPointIdx(FINANCE_SERIES[tf].length - 1);
              }}
              className={`px-2 py-0.5 text-[11px] font-mono rounded-[4px] transition-colors cursor-pointer ${
                timeframe === tf
                  ? 'bg-[#38BDF8] text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Interactive SVG Multi-Node Line Chart */}
      <div className="relative my-2 flex-1 min-h-[165px] flex items-center">
        <svg
          viewBox="0 0 520 168"
          className="w-full h-full overflow-visible select-none"
        >
          <defs>
            <linearGradient id="neonCyanArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.32" />
              <stop offset="75%" stopColor="#0EA5E9" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0.0" />
            </linearGradient>
            <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Horizontal Grid Lines */}
          {[32, 68, 104, 140].map((gy) => (
            <line
              key={gy}
              x1="20"
              y1={gy}
              x2="500"
              y2={gy}
              stroke="#1E293B"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
          ))}

          {/* Area under primary revenue curve */}
          <path d={areaPath} fill="url(#neonCyanArea)" />

          {/* Optional secondary ERP margin curve */}
          {showMarginOverlay && (
            <path
              d={marginLinePath}
              fill="none"
              stroke="#64748B"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
          )}

          {/* Primary Neon Blue Revenue Line */}
          <path
            d={linePath}
            fill="none"
            stroke="#38BDF8"
            strokeWidth="2.25"
            filter="url(#neonGlow)"
          />

          {/* Interactive Clickable / Hoverable Telemetry Nodes */}
          {svgCoords.map((pt) => {
            const isSelected = pt.index === selectedPointIdx;
            return (
              <g
                key={pt.id}
                onClick={() => setSelectedPointIdx(pt.index)}
                className="cursor-pointer group"
              >
                {/* Vertical guide line on active node */}
                {isSelected && (
                  <line
                    x1={pt.x}
                    y1={14}
                    x2={pt.x}
                    y2={152}
                    stroke="#38BDF8"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                    opacity="0.7"
                  />
                )}

                {/* Outer halo for selected node */}
                {isSelected && (
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r="9"
                    fill="#38BDF8"
                    fillOpacity="0.2"
                    stroke="#38BDF8"
                    strokeWidth="1"
                  />
                )}

                {/* Interactive Node Circle */}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isSelected ? 4.5 : 3.5}
                  fill={isSelected ? '#FFFFFF' : '#0B0F17'}
                  stroke="#38BDF8"
                  strokeWidth="2.2"
                />

                {/* X-Axis label */}
                <text
                  x={pt.x}
                  y={164}
                  textAnchor="middle"
                  className={`font-mono text-[9px] ${
                    isSelected ? 'fill-[#38BDF8] font-semibold' : 'fill-slate-500'
                  }`}
                >
                  {pt.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Bottom Selected Node Telemetry Strip */}
      <div className="pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-2 text-slate-300 truncate">
          <span className="h-2 w-2 rounded-full bg-[#38BDF8] shrink-0" />
          <span className="font-mono text-[#38BDF8]">{activePoint.label}:</span>
          <span className="truncate text-slate-300">{activePoint.annotation}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setShowMarginOverlay((v) => !v)}
            className={`font-mono text-[10px] px-2 py-0.5 rounded border cursor-pointer ${
              showMarginOverlay
                ? 'border-[#38BDF8]/40 text-[#38BDF8] bg-[#38BDF8]/10'
                : 'border-slate-800 text-slate-500'
            }`}
          >
            {showMarginOverlay ? 'Margin Curve: ON' : 'Margin Curve: OFF'}
          </button>
          <span className="font-mono text-slate-400">
            Deals: <strong className="text-slate-200">{activePoint.activeDeals}</strong>
          </span>
        </div>
      </div>
    </div>
  );

  const renderWorkflowWindowContent = () => (
    <div className="p-4 flex flex-col justify-between h-[calc(100%-36px)] bg-[#0B0F17]/85">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            DAG ENGINE ONLINE
          </span>
          <span className="text-[11px] font-mono text-slate-400">
            Executions:{' '}
            <strong className="text-slate-200">{workflowExecCount.toLocaleString()}</strong>
          </span>
        </div>

        <button
          type="button"
          onClick={triggerWorkflowRun}
          disabled={workflowRunning}
          className="h-7 px-2.5 rounded-[5px] bg-[#38BDF8] hover:bg-[#0EA5E9] disabled:opacity-50 text-slate-950 font-semibold text-[11px] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Play className="h-3 w-3 fill-current" />
          {workflowRunning ? 'Executing Pipeline...' : 'Execute Live Test'}
        </button>
      </div>

      {/* Interactive Node Graph Canvas */}
      <div className="relative my-2 flex-1 min-h-[175px] rounded-[6px] border border-slate-800/90 bg-[#070A10] overflow-hidden">
        {/* Subtle Dot Matrix Grid Background */}
        <div
          className="absolute inset-0 opacity-25 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(#38BDF8 1px, transparent 1px)',
            backgroundSize: '18px 18px',
          }}
        />

        {/* SVG Bezier Edges connecting the nodes */}
        <svg viewBox="0 0 700 220" className="w-full h-full">
          <defs>
            <linearGradient id="edgeCyan" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#0284C7" stopOpacity="0.45" />
            </linearGradient>
          </defs>

          {/* Edge 1 -> 2 */}
          <path
            d="M 195 106 C 230 106, 230 58, 268 58"
            fill="none"
            stroke="url(#edgeCyan)"
            strokeWidth="2"
          />
          {/* Edge 1 -> 3 */}
          <path
            d="M 195 106 C 230 106, 230 170, 268 170"
            fill="none"
            stroke="url(#edgeCyan)"
            strokeWidth="2"
          />
          {/* Edge 2 -> 4 */}
          <path
            d="M 445 58 C 480 58, 480 76, 515 76"
            fill="none"
            stroke="url(#edgeCyan)"
            strokeWidth="2"
          />
          {/* Edge 3 -> 4 */}
          <path
            d="M 445 170 C 480 170, 480 76, 515 76"
            fill="none"
            stroke="#334155"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          {/* Edge 3 -> 5 */}
          <path
            d="M 445 170 C 480 170, 480 178, 515 178"
            fill="none"
            stroke="url(#edgeCyan)"
            strokeWidth="2"
          />
          {/* Edge 4 -> 5 */}
          <path
            d="M 605 108 L 605 148"
            fill="none"
            stroke="url(#edgeCyan)"
            strokeWidth="1.75"
            strokeDasharray="3 3"
          />

          {/* Interactive SVG ForeignObject / Group Nodes */}
          {WORKFLOW_NODES.map((node, idx) => {
            const isSelected = node.id === selectedNodeId;
            const isStepActive = activeStepIndex === idx;
            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                onClick={() => setSelectedNodeId(node.id)}
                className="cursor-pointer"
              >
                <rect
                  width="172"
                  height="56"
                  rx="6"
                  fill={isSelected ? '#0F172A' : '#0B111E'}
                  stroke={
                    isStepActive
                      ? '#22C55E'
                      : isSelected
                      ? '#38BDF8'
                      : '#1E293B'
                  }
                  strokeWidth={isSelected || isStepActive ? '1.8' : '1.2'}
                />

                {/* Status indicator dot */}
                <circle
                  cx="12"
                  cy="15"
                  r="3.5"
                  fill={
                    isStepActive
                      ? '#22C55E'
                      : node.status === 'running'
                      ? '#38BDF8'
                      : '#10B981'
                  }
                />

                {/* Node Type & Latency */}
                <text
                  x="22"
                  y="18"
                  className="font-mono text-[8.5px] fill-[#38BDF8] uppercase tracking-wider"
                >
                  {node.type}
                </text>
                <text
                  x="162"
                  y="18"
                  textAnchor="end"
                  className="font-mono text-[8.5px] fill-slate-400"
                >
                  {node.latencyMs}ms
                </text>

                {/* Node Title */}
                <text
                  x="10"
                  y="34"
                  className="text-[10.5px] font-semibold fill-slate-100"
                >
                  {node.title}
                </text>

                {/* Node Subtitle */}
                <text x="10" y="47" className="text-[8.5px] fill-slate-400">
                  {node.subtitle.slice(0, 30)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Selected Node Inspector Strip */}
      <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] px-1.5 py-0.2 bg-[#38BDF8]/15 text-[#38BDF8] rounded">
              {selectedWorkflowNode.type}
            </span>
            <span className="font-semibold text-slate-200 truncate">
              {selectedWorkflowNode.title}
            </span>
            <span className="font-mono text-[10px] text-emerald-400">
              SLA {selectedWorkflowNode.successRate}
            </span>
          </div>
          <p className="text-slate-400 text-[11px] truncate">
            {selectedWorkflowNode.ruleSummary}
          </p>
        </div>
        <code className="font-mono text-[10px] text-slate-300 bg-slate-900/90 border border-slate-800 px-2 py-1 rounded max-w-[270px] truncate shrink-0">
          {selectedWorkflowNode.samplePayload}
        </code>
      </div>
    </div>
  );

  const renderCustomerProfilesWindowContent = () => (
    <div className="p-4 flex flex-col justify-between h-[calc(100%-36px)] bg-[#0B0F17]/85">
      {/* Filter & Search Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <div className="relative flex-1 max-w-[220px]">
            <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder="Filter accounts, SKU, code..."
              className="w-full h-7 rounded-[5px] bg-slate-900/90 border border-slate-800 pl-8 pr-2 text-[11px] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#38BDF8]"
            />
          </div>

          <div className="flex items-center gap-1 bg-slate-900/80 p-0.5 rounded-[5px] border border-slate-800">
            {(['ALL', 'Active Contract', 'Expansion', 'Qualified Lead', 'At Risk'] as const).map(
              (st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStageFilter(st)}
                  className={`px-2 py-0.5 text-[10px] font-mono rounded-[4px] transition-colors cursor-pointer ${
                    stageFilter === st
                      ? 'bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/40 font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {st === 'ALL' ? 'All' : st.split(' ')[0]}
                </button>
              )
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowNewLeadModal(true)}
          className="h-7 px-2.5 rounded-[5px] border border-[#38BDF8]/40 bg-[#38BDF8]/10 hover:bg-[#38BDF8]/20 text-[#38BDF8] text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer"
        >
          <Plus className="h-3 w-3" />
          New CRM Deal
        </button>
      </div>

      {/* Split Data Table + Active Customer 360 Mini-Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 my-2 flex-1 min-h-0 overflow-hidden">
        {/* Rich Data Table */}
        <div className="lg:col-span-8 overflow-y-auto border border-slate-800/80 rounded-[6px] bg-[#070A10]/90">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] font-mono uppercase tracking-[0.05em] text-slate-400 bg-slate-900/60 sticky top-0">
                <th className="py-2 px-2.5">Account / Contact</th>
                <th className="py-2 px-2">Stage</th>
                <th className="py-2 px-2 text-right">Contract ARR</th>
                <th className="py-2 px-2">ERP SKU Allocation</th>
                <th className="py-2 px-2 text-right">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-[11.5px]">
              {filteredCustomers.map((c) => {
                const isSelected = c.id === selectedCustomer?.id;
                const stageDot =
                  c.stage === 'Active Contract'
                    ? 'bg-emerald-400'
                    : c.stage === 'Expansion'
                    ? 'bg-[#38BDF8]'
                    : c.stage === 'Qualified Lead'
                    ? 'bg-amber-400'
                    : 'bg-rose-500';
                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedCustomerId(c.id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[#38BDF8]/12 text-white'
                        : 'hover:bg-slate-900/70 text-slate-300'
                    }`}
                  >
                    <td className="py-2 px-2.5">
                      <div className="font-medium text-slate-100 flex items-center gap-1.5">
                        <span className="font-mono text-[10px] text-[#38BDF8]">{c.code}</span>
                        <span className="truncate max-w-[140px]">{c.company}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {c.contactName} · {c.region}
                      </div>
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
                        <span className={`h-1.5 w-1.5 rounded-full ${stageDot}`} />
                        {c.stage}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-100 font-medium">
                      ${(c.arrValue / 1000).toLocaleString()}K
                    </td>
                    <td className="py-2 px-2 text-[11px] text-slate-400 truncate max-w-[155px]">
                      {c.erpSkuAllocation}
                    </td>
                    <td className="py-2 px-2 text-right font-mono tabular-nums">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                          c.healthScore >= 90
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : c.healthScore >= 80
                            ? 'bg-[#38BDF8]/15 text-[#38BDF8]'
                            : 'bg-rose-500/15 text-rose-400'
                        }`}
                      >
                        {c.healthScore}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Customer 360 & ERP Sync Inspector Card */}
        {selectedCustomer && (
          <div className="lg:col-span-4 border border-slate-800/90 rounded-[6px] bg-[#070A10]/90 p-3 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-[#38BDF8] uppercase tracking-wider">
                  {selectedCustomer.code} · {selectedCustomer.segment}
                </span>
                <span className="font-mono text-[10px] text-slate-500">
                  {selectedCustomer.lastTouch}
                </span>
              </div>
              <div>
                <h4 className="text-[13px] font-semibold text-white">
                  {selectedCustomer.company}
                </h4>
                <p className="text-[11px] text-slate-400">
                  {selectedCustomer.contactName} ({selectedCustomer.contactRole})
                </p>
              </div>

              <div className="pt-2 border-t border-slate-800/80 space-y-1.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">Contract ARR</span>
                  <span className="font-mono text-slate-100 font-semibold">
                    ${selectedCustomer.arrValue.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Fulfillment SLA</span>
                  <span className="font-mono text-emerald-400">
                    {selectedCustomer.fulfillmentSla}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Region Hub</span>
                  <span className="text-slate-300">{selectedCustomer.region}</span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={triggerWorkflowRun}
                className="w-full h-7 rounded-[5px] bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-mono inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="h-3 w-3 text-[#38BDF8]" />
                Sync ERP Order Ledger
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer Summary */}
      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
        <span>
          Showing <strong className="text-slate-200">{filteredCustomers.length}</strong> of{' '}
          {customers.length} enterprise CRM accounts
        </span>
        <span className="font-mono">
          Pipeline ARR:{' '}
          <strong className="text-[#38BDF8]">${(totalArr / 1_000_000).toFixed(2)}M</strong>
        </span>
      </div>
    </div>
  );

  const renderErpSupplyWindowContent = () => (
    <div className="p-4 flex flex-col justify-between h-[calc(100%-36px)] bg-[#0B0F17]/85">
      <div className="flex items-center justify-between pb-2.5 border-b border-slate-800/80">
        <div className="text-[11px] text-slate-300 font-medium">
          Active Warehouse & Workforce SKU Matrix
        </div>
        <span className="font-mono text-[10px] text-[#38BDF8]">3 GLOBAL HUBS ONLINE</span>
      </div>

      <div className="my-2 flex-1 overflow-y-auto divide-y divide-slate-800/70">
        {inventory.map((item) => {
          const isLow = item.status === 'Low Stock';
          return (
            <div
              key={item.sku}
              className="py-2.5 flex items-center justify-between gap-3 text-[11.5px]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-[#38BDF8]">{item.sku}</span>
                  <span className="font-medium text-slate-100 truncate">{item.name}</span>
                </div>
                <div className="text-[10.5px] text-slate-400 flex items-center gap-2 mt-0.5">
                  <span>{item.warehouse}</span>
                  <span>·</span>
                  <span className="font-mono text-slate-300">
                    Avail: {item.available} / Alloc: {item.allocated}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isLow ? (
                  <button
                    type="button"
                    onClick={() => handleRestockSku(item.sku)}
                    className="h-6 px-2 rounded bg-amber-500/20 border border-amber-400/40 text-amber-300 hover:bg-amber-500/30 font-mono text-[10px] cursor-pointer"
                  >
                    + Auto-Restock
                  </button>
                ) : (
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {item.status}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
        <span>Customs & Freight Telemetry: NOMINAL</span>
        <span className="text-emerald-400">99.4% SLA</span>
      </div>
    </div>
  );

  const renderWindowBody = (id: WindowId) => {
    switch (id) {
      case 'finance_chart':
        return renderFinanceWindowContent();
      case 'workflow_graph':
        return renderWorkflowWindowContent();
      case 'customer_profiles':
        return renderCustomerProfilesWindowContent();
      case 'erp_supply':
        return renderErpSupplyWindowContent();
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#060911] text-slate-100 flex flex-col overflow-hidden select-none">
      {/* ====================================================================
          TOP OS SYSTEM BAR (48px)
      ==================================================================== */}
      <header className="h-12 px-4 border-b border-slate-800/90 bg-[#090D16]/95 backdrop-blur-md flex items-center justify-between gap-4 z-50 shrink-0">
        {/* Left Brand & OS Mode Indicator */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-[#38BDF8] shadow-[0_0_10px_#38BDF8]" />
            <span className="font-mono text-[13px] font-semibold tracking-tight text-white">
              HIRENEST<span className="text-[#38BDF8]">OS</span>
            </span>
            <span className="hidden sm:inline-block font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
              ERP + CRM + WINDOW KERNEL v4.2
            </span>
          </div>

          {liveOrgsCount !== undefined && liveOrgsCount > 0 && (
            <span className="hidden md:inline-flex items-center gap-1.5 font-mono text-[11px] text-emerald-400 bg-emerald-950/50 border border-emerald-800/50 px-2 py-0.5 rounded">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Supabase Connected ({liveOrgsCount} orgs)
            </span>
          )}
        </div>

        {/* Center Window Management Mode Switcher */}
        <div className="flex items-center gap-1.5 bg-[#060911] p-1 rounded-[7px] border border-slate-800">
          <button
            type="button"
            onClick={() => setWindowMode('overlapping')}
            className={`h-7 px-2.5 rounded-[5px] text-[11px] font-mono inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              windowMode === 'overlapping'
                ? 'bg-[#38BDF8] text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            OS Overlapping Windows
          </button>
          <button
            type="button"
            onClick={() => setWindowMode('tiled')}
            className={`h-7 px-2.5 rounded-[5px] text-[11px] font-mono inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              windowMode === 'tiled'
                ? 'bg-[#38BDF8] text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Grid className="h-3.5 w-3.5" />
            Tiled Grid
          </button>
          <button
            type="button"
            onClick={cascadeWindows}
            className="hidden md:inline-flex h-7 px-2.5 rounded-[5px] text-[11px] font-mono items-center gap-1 text-slate-400 hover:text-slate-200 hover:bg-slate-900 cursor-pointer"
          >
            Cascade
          </button>
          <button
            type="button"
            onClick={resetAllWindows}
            title="Reset all windows to default layout"
            className="h-7 px-2 rounded-[5px] text-[11px] font-mono inline-flex items-center gap-1 text-slate-400 hover:text-slate-200 hover:bg-slate-900 cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>

        {/* Right Telemetry & Role Workspace Return Link */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setLivePulse((p) => !p)}
            className={`hidden sm:inline-flex h-7 px-2.5 rounded-[5px] border font-mono text-[11px] items-center gap-1.5 cursor-pointer ${
              livePulse
                ? 'border-[#38BDF8]/40 bg-[#38BDF8]/10 text-[#38BDF8]'
                : 'border-slate-800 bg-slate-900 text-slate-400'
            }`}
          >
            <Activity className="h-3.5 w-3.5" />
            {livePulse ? 'LIVE STREAM' : 'PAUSED'}
          </button>

          <Link
            to={session ? homeRoute : '/signin'}
            className="h-7 px-3 rounded-[5px] border border-slate-700 bg-slate-900 hover:bg-slate-800 text-[11px] font-medium text-slate-200 inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="h-3 w-3" />
            {session ? `Staffing Portal (${profile?.role || 'HQ'})` : 'Sign In Portal'}
          </Link>
        </div>
      </header>

      {/* ====================================================================
          MAIN BODY: LEFT SIDEBAR (CRM + ERP) + OS WINDOW WORKSPACE
      ==================================================================== */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* LEFT SIDEBAR NAVIGATION FOR CRM & ERP (236px) */}
        <aside className="w-[236px] border-r border-slate-800/90 bg-[#090D16]/95 flex flex-col justify-between shrink-0">
          <div className="p-3 space-y-5 overflow-y-auto">
            {/* CRM Navigation Group */}
            <div className="space-y-1">
              <div className="px-2 pb-1 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.08em] text-slate-500">
                <span>CRM · Customer & Pipeline</span>
                <span className="text-[#38BDF8]">03</span>
              </div>
              {[
                {
                  id: 'crm_leads' as NavSection,
                  label: 'Inbound Leads',
                  badge: '18',
                  icon: Zap,
                },
                {
                  id: 'crm_pipeline' as NavSection,
                  label: 'Deal Pipeline & ARR',
                  badge: '$7.39M',
                  icon: TrendingUp,
                },
                {
                  id: 'crm_customers' as NavSection,
                  label: 'Customer 360 Profiles',
                  badge: String(customers.length),
                  icon: Users,
                },
              ].map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSidebarSelect(item.id)}
                    className={`w-full h-8 px-2.5 rounded-[6px] flex items-center justify-between text-[12px] transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#38BDF8]/15 text-white border border-[#38BDF8]/35 font-medium'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Icon
                        className={`h-3.5 w-3.5 ${
                          active ? 'text-[#38BDF8]' : 'text-slate-500'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">
                      {item.badge}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* ERP Navigation Group */}
            <div className="space-y-1">
              <div className="px-2 pb-1 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.08em] text-slate-500">
                <span>ERP · Resource & Finance</span>
                <span className="text-[#38BDF8]">03</span>
              </div>
              {[
                {
                  id: 'erp_inventory' as NavSection,
                  label: 'SKU Inventory Matrix',
                  badge: '635 u',
                  icon: Boxes,
                },
                {
                  id: 'erp_supply_chain' as NavSection,
                  label: 'Supply Chain & Freight',
                  badge: '99.4%',
                  icon: Truck,
                },
                {
                  id: 'erp_finance' as NavSection,
                  label: 'Finance & GL Cashflow',
                  badge: '78.5%',
                  icon: DollarSign,
                },
              ].map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSidebarSelect(item.id)}
                    className={`w-full h-8 px-2.5 rounded-[6px] flex items-center justify-between text-[12px] transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#38BDF8]/15 text-white border border-[#38BDF8]/35 font-medium'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Icon
                        className={`h-3.5 w-3.5 ${
                          active ? 'text-[#38BDF8]' : 'text-slate-500'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">
                      {item.badge}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Active OS Windows Manager List */}
            <div className="space-y-1 pt-2 border-t border-slate-800/80">
              <div className="px-2 pb-1 text-[10px] font-mono uppercase tracking-[0.08em] text-slate-500">
                OS Window Processes
              </div>
              {windows.map((w) => {
                const isFocused = focusedWindow === w.id && w.isOpen && !w.isMinimized;
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => focusWindow(w.id)}
                    className={`w-full h-7 px-2.5 rounded-[5px] flex items-center justify-between text-[11px] transition-colors cursor-pointer ${
                      isFocused
                        ? 'bg-slate-800/90 text-[#38BDF8] font-medium'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                    }`}
                  >
                    <span className="truncate">{w.title.split(' ')[0]} {w.title.split(' ')[1]}</span>
                    <span className="font-mono text-[9.5px] uppercase">
                      {!w.isOpen ? 'CLOSED' : w.isMinimized ? 'MIN' : 'LIVE'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bottom System Telemetry Card */}
          <div className="p-3 border-t border-slate-800/90 bg-[#060911]/80 space-y-2">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
              <span>KERNEL LATENCY</span>
              <span className="text-[#38BDF8]">14.2 ms</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-slate-900 overflow-hidden">
              <div className="h-full w-[88%] bg-[#38BDF8]" />
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
              <span>SYNC: CRM ↔ ERP</span>
              <span className="text-emerald-400">LOCKED</span>
            </div>
          </div>
        </aside>

        {/* ====================================================================
            MAIN OS WORKSPACE CANVAS
        ==================================================================== */}
        <main
          className="flex-1 relative overflow-auto p-4"
          style={{
            backgroundImage:
              'radial-gradient(circle at 18% 18%, rgba(56, 189, 248, 0.08), transparent 38%), radial-gradient(circle at 82% 75%, rgba(14, 165, 233, 0.07), transparent 42%), linear-gradient(to right, rgba(30, 41, 59, 0.22) 1px, transparent 1px), linear-gradient(to bottom, rgba(30, 41, 59, 0.22) 1px, transparent 1px)',
            backgroundSize: '100% 100%, 100% 100%, 32px 32px, 32px 32px',
          }}
        >
          {/* Case 1: Single Maximized Window */}
          {maximizedWin ? (
            <div className="w-full h-[calc(100vh-116px)] rounded-[10px] border border-[#38BDF8]/40 bg-[#0B0F19]/90 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col">
              {renderWindowHeader(maximizedWin)}
              <div className="flex-1 min-h-0">{renderWindowBody(maximizedWin.id)}</div>
            </div>
          ) : windowMode === 'tiled' ? (
            /* Case 2: Tiled 4K Grid Mode */
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 pb-12">
              {windows
                .filter((w) => w.isOpen && !w.isMinimized)
                .map((win) => {
                  const colSpan =
                    win.id === 'finance_chart'
                      ? 'xl:col-span-6 h-[390px]'
                      : win.id === 'workflow_graph'
                      ? 'xl:col-span-6 h-[390px]'
                      : win.id === 'customer_profiles'
                      ? 'xl:col-span-7 h-[390px]'
                      : 'xl:col-span-5 h-[390px]';
                  const isFocused = focusedWindow === win.id;
                  return (
                    <div
                      key={win.id}
                      onMouseDown={() => focusWindow(win.id)}
                      className={`${colSpan} rounded-[10px] border backdrop-blur-xl overflow-hidden flex flex-col transition-colors ${
                        isFocused
                          ? 'border-[#38BDF8]/45 shadow-[0_0_28px_rgba(56,189,248,0.10)]'
                          : 'border-slate-800/90'
                      }`}
                    >
                      {renderWindowHeader(win)}
                      <div className="flex-1 min-h-0">{renderWindowBody(win.id)}</div>
                    </div>
                  );
                })}
            </div>
          ) : (
            /* Case 3: Overlapping OS Glassmorphic Windowing System (Desktop Freeform + Responsive Fallback) */
            <div className="relative min-h-[730px] w-full">
              {windows
                .filter((w) => w.isOpen && !w.isMinimized)
                .map((win) => {
                  const isFocused = focusedWindow === win.id;
                  return (
                    <div
                      key={win.id}
                      onMouseDown={() => focusWindow(win.id)}
                      style={{
                        zIndex: win.zIndex,
                        left: `${win.x}px`,
                        top: `${win.y}px`,
                        width: `${win.w}px`,
                        height: `${win.h}px`,
                      }}
                      className={`xl:absolute mb-4 xl:mb-0 w-full xl:w-auto rounded-[10px] border bg-[#0B0F19]/85 backdrop-blur-xl overflow-hidden flex flex-col transition-shadow ${
                        isFocused
                          ? 'border-[#38BDF8]/55 shadow-[0_18px_50px_rgba(0,0,0,0.75),0_0_25px_rgba(56,189,248,0.14)]'
                          : 'border-slate-800/90 shadow-[0_12px_32px_rgba(0,0,0,0.6)] opacity-95'
                      }`}
                    >
                      {renderWindowHeader(win)}
                      <div className="flex-1 min-h-0">{renderWindowBody(win.id)}</div>
                    </div>
                  );
                })}
            </div>
          )}

          {/* ================================================================
              BOTTOM FLOATING OS DOCK / TASKBAR
          ================================================================ */}
          <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-700/80 bg-[#090D16]/90 backdrop-blur-xl shadow-2xl">
            {windows.map((w) => {
              const active = focusedWindow === w.id && w.isOpen && !w.isMinimized;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => focusWindow(w.id)}
                  className={`h-7 px-3 rounded-full font-mono text-[11px] flex items-center gap-1.5 transition-all cursor-pointer ${
                    active
                      ? 'bg-[#38BDF8] text-slate-950 font-semibold shadow-[0_0_12px_rgba(56,189,248,0.5)]'
                      : w.isOpen && !w.isMinimized
                      ? 'bg-slate-800/90 text-slate-200 hover:bg-slate-700'
                      : 'bg-slate-900/70 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      active
                        ? 'bg-slate-950'
                        : w.isOpen && !w.isMinimized
                        ? 'bg-[#38BDF8]'
                        : 'bg-slate-600'
                    }`}
                  />
                  <span>{w.category.split('·')[1]?.trim() || w.title}</span>
                </button>
              );
            })}
          </div>
        </main>
      </div>

      {/* ====================================================================
          NEW CRM DEAL MODAL (Triggers Automated ERP + CRM Workflow)
      ==================================================================== */}
      {showNewLeadModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-[420px] rounded-[10px] border border-[#38BDF8]/40 bg-[#0B0F19] p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="font-mono text-[10px] text-[#38BDF8] uppercase">
                  CRM → ERP INGEST
                </span>
                <h3 className="text-[15px] font-semibold text-white">
                  Register Enterprise CRM Deal
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowNewLeadModal(false)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateLead} className="space-y-3 text-[12px]">
              <div className="space-y-1">
                <label className="block text-slate-300 font-medium">
                  Enterprise Account Name
                </label>
                <input
                  type="text"
                  required
                  value={newLeadCompany}
                  onChange={(e) => setNewLeadCompany(e.target.value)}
                  placeholder="e.g. Hyperion Photonics Inc."
                  className="w-full h-8 rounded-[6px] bg-slate-900 border border-slate-700 px-3 text-white focus:outline-none focus:border-[#38BDF8]"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-300 font-medium">
                  Executive Sponsor / Contact
                </label>
                <input
                  type="text"
                  value={newLeadContact}
                  onChange={(e) => setNewLeadContact(e.target.value)}
                  placeholder="e.g. Nadia Chen · SVP Engineering"
                  className="w-full h-8 rounded-[6px] bg-slate-900 border border-slate-700 px-3 text-white focus:outline-none focus:border-[#38BDF8]"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-300 font-medium">
                  Committed Contract ARR (USD)
                </label>
                <input
                  type="number"
                  required
                  value={newLeadArr}
                  onChange={(e) => setNewLeadArr(e.target.value)}
                  className="w-full h-8 rounded-[6px] bg-slate-900 border border-slate-700 px-3 font-mono text-white focus:outline-none focus:border-[#38BDF8]"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewLeadModal(false)}
                  className="h-8 px-3 rounded-[6px] border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-8 px-3.5 rounded-[6px] bg-[#38BDF8] hover:bg-[#0EA5E9] text-slate-950 font-semibold cursor-pointer"
                >
                  Ingest & Run ERP Workflow
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
