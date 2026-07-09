// ── Domain vocabulary bank for Whisper biasing ───────────────────────────────
// Whisper mishears domain jargon it has no reason to expect ("RAG pipeline" →
// "React pipeline" / "drag pipeline"), and a wrong transcript produces a
// confidently-wrong answer. Whisper's `prompt` param biases it toward terms it
// contains — BUT the prompt has a hard ~224-token limit and over-stuffing it
// makes Whisper hallucinate/echo the prompt. So we DON'T dump every keyword:
// we detect the interview's domain from the user's own context/résumé and inject
// only that domain's high-value terms plus a small universal business set, kept
// well under the limit. This is the standard OpenAI-recommended technique
// (pass a short comma-separated list of likely proper nouns/acronyms).
//
// The BANK itself can be large — it covers ~40 professional fields — because only
// the 1–2 domains that actually match the user's session are ever injected. Add
// new fields here freely; detection keeps the injected prompt small.
//
// What belongs in a `terms` list: things Whisper gets WRONG — acronyms (spelled
// as letters), tool/brand proper nouns, and technical jargon. Not ordinary
// English words (Whisper already transcribes those correctly; they'd just waste
// the token budget). English only.

// Always-on: generic business/interview acronyms common across nearly every
// professional interview and frequently mis-transcribed.
const UNIVERSAL = [
  'KPI', 'OKR', 'ROI', 'KRA', 'B2B', 'B2C', 'SaaS', 'MVP', 'POC', 'SLA',
  'stakeholder', 'cross-functional', 'end-to-end', 'go-to-market', 'roadmap',
  'Agile', 'Scrum', 'Kanban', 'sprint', 'onboarding', 'scalability', 'KPIs',
];

// Each domain: `triggers` are lowercase words/phrases we look for (whole-word)
// in the user's context/résumé to decide the domain applies; `terms` are the
// proper spellings to bias Whisper toward.
const DOMAINS = {
  // ── Technology ──────────────────────────────────────────────────────────
  ai_ml: {
    triggers: ['ai', 'machine learning', 'ml', 'genai', 'gen ai', 'llm', 'deep learning',
      'data scientist', 'nlp', 'neural', 'model', 'artificial intelligence', 'ml engineer'],
    terms: ['RAG', 'RAG pipeline', 'retrieval augmented generation', 'LLM', 'RLHF', 'GenAI',
      'transformer', 'embeddings', 'vector database', 'fine-tuning', 'prompt engineering', 'inference',
      'quantization', 'hallucination', 'Hugging Face', 'PyTorch', 'TensorFlow', 'LangChain', 'MLOps',
      'GPT', 'BERT', 'CNN', 'RNN', 'LSTM', 'gradient descent', 'overfitting', 'hyperparameter',
      'SageMaker', 'Vertex AI', 'reranker', 'agentic', 'multimodal', 'tokenizer'],
  },
  software: {
    triggers: ['software', 'developer', 'engineer', 'backend', 'full stack', 'programming',
      'coding', 'api', 'sde', 'swe', 'system design'],
    terms: ['Kubernetes', 'Docker', 'microservices', 'REST API', 'GraphQL', 'gRPC', 'PostgreSQL',
      'MongoDB', 'Redis', 'Kafka', 'RabbitMQ', 'OAuth', 'JWT', 'CI/CD', 'idempotent', 'sharding',
      'load balancer', 'API gateway', 'caching', 'latency', 'throughput', 'concurrency', 'mutex',
      'big-O', 'design patterns', 'refactoring'],
  },
  frontend: {
    triggers: ['frontend', 'front end', 'front-end', 'react', 'angular', 'vue', 'ui developer',
      'web developer', 'javascript'],
    terms: ['React', 'Angular', 'Vue', 'Next.js', 'TypeScript', 'JavaScript', 'DOM', 'CSS', 'SASS',
      'Tailwind', 'Redux', 'Webpack', 'Vite', 'JSX', 'hooks', 'SSR', 'hydration', 'accessibility',
      'responsive design', 'WebSocket', 'lazy loading'],
  },
  mobile: {
    triggers: ['mobile', 'ios', 'android', 'flutter', 'react native', 'swift', 'kotlin', 'app developer'],
    terms: ['iOS', 'Android', 'Swift', 'SwiftUI', 'Kotlin', 'Jetpack Compose', 'Flutter', 'Dart',
      'React Native', 'Xcode', 'Gradle', 'APK', 'App Store', 'Play Store', 'push notifications',
      'deep linking', 'lifecycle'],
  },
  cloud: {
    triggers: ['aws', 'azure', 'gcp', 'cloud', 'serverless', 'infrastructure'],
    terms: ['AWS', 'Azure', 'GCP', 'EC2', 'S3', 'Lambda', 'DynamoDB', 'Kubernetes', 'serverless',
      'VPC', 'IAM', 'CloudFormation', 'Terraform', 'auto-scaling', 'CDN', 'EKS', 'Fargate'],
  },
  devops: {
    triggers: ['devops', 'sre', 'site reliability', 'platform engineer', 'ci cd', 'observability'],
    terms: ['CI/CD', 'Jenkins', 'GitLab', 'Terraform', 'Ansible', 'Kubernetes', 'Helm', 'Prometheus',
      'Grafana', 'Datadog', 'observability', 'SLI', 'SLO', 'incident response', 'blue-green deployment',
      'canary release', 'IaC', 'runbook'],
  },
  cybersecurity: {
    triggers: ['security', 'cyber', 'infosec', 'soc analyst', 'penetration', 'pentest', 'threat'],
    terms: ['SIEM', 'SOC', 'IDS', 'IPS', 'firewall', 'zero trust', 'penetration testing', 'OWASP',
      'CVE', 'phishing', 'ransomware', 'endpoint', 'IAM', 'MFA', 'encryption', 'TLS', 'DDoS',
      'vulnerability', 'threat modeling', 'SOC 2', 'ISO 27001', 'NIST', 'XDR', 'EDR'],
  },
  data_analytics: {
    triggers: ['data engineer', 'data analyst', 'analytics', 'etl', 'sql', 'warehouse',
      'business intelligence', 'bi', 'big data', 'data pipeline'],
    terms: ['SQL', 'ETL', 'ELT', 'Snowflake', 'Databricks', 'Apache Spark', 'Hadoop', 'Airflow',
      'dbt', 'Kafka', 'data warehouse', 'data lake', 'Redshift', 'BigQuery', 'Tableau', 'Power BI',
      'star schema', 'dimensional modeling', 'OLAP', 'partitioning', 'Parquet'],
  },
  qa_testing: {
    triggers: ['qa', 'quality assurance', 'test engineer', 'automation testing', 'sdet', 'tester'],
    terms: ['Selenium', 'Cypress', 'Playwright', 'JUnit', 'TestNG', 'Appium', 'regression testing',
      'smoke testing', 'test automation', 'CI/CD', 'BDD', 'TDD', 'Cucumber', 'Postman', 'test coverage',
      'defect', 'SDET'],
  },
  blockchain: {
    triggers: ['blockchain', 'web3', 'crypto', 'smart contract', 'solidity', 'ethereum', 'defi'],
    terms: ['blockchain', 'Ethereum', 'Solidity', 'smart contract', 'DeFi', 'NFT', 'Web3', 'gas fees',
      'consensus', 'proof of stake', 'wallet', 'ERC-20', 'DAO', 'Layer 2', 'ledger', 'tokenomics'],
  },
  networking: {
    triggers: ['network engineer', 'networking', 'cisco', 'ccna', 'routing', 'switching'],
    terms: ['TCP/IP', 'BGP', 'OSPF', 'VLAN', 'subnet', 'DNS', 'DHCP', 'NAT', 'Cisco', 'CCNA', 'MPLS',
      'load balancer', 'firewall', 'VPN', 'SD-WAN', 'latency', 'packet', 'router', 'switch'],
  },

  // ── Product · Design · Project ─────────────────────────────────────────────
  product: {
    triggers: ['product manager', 'product owner', 'go-to-market', 'gtm', 'user experience',
      'roadmap', 'growth', 'product management'],
    terms: ['roadmap', 'backlog', 'user story', 'A/B testing', 'north star metric', 'retention',
      'churn', 'funnel', 'activation', 'product-market fit', 'MVP', 'Jira', 'Figma', 'discovery',
      'prioritization', 'RICE', 'cohort analysis'],
  },
  design_ux: {
    triggers: ['designer', 'ux', 'ui', 'user experience', 'user interface', 'product design',
      'figma', 'graphic design'],
    terms: ['Figma', 'Sketch', 'wireframe', 'prototype', 'usability testing', 'design system',
      'user research', 'persona', 'user flow', 'accessibility', 'WCAG', 'information architecture',
      'affordance', 'heuristic evaluation', 'Adobe XD', 'design thinking'],
  },
  project_management: {
    triggers: ['project manager', 'program manager', 'pmo', 'pmp', 'scrum master', 'delivery manager'],
    terms: ['Agile', 'Scrum', 'Kanban', 'Waterfall', 'sprint', 'PMP', 'PMBOK', 'Gantt chart',
      'critical path', 'stakeholder management', 'risk register', 'RACI', 'burndown', 'velocity',
      'milestone', 'scope creep', 'JIRA', 'PRINCE2'],
  },
  business_analysis: {
    triggers: ['business analyst', 'ba ', 'requirements gathering', 'process improvement', 'systems analyst'],
    terms: ['requirements', 'user stories', 'use case', 'BRD', 'FRD', 'gap analysis', 'stakeholder',
      'process mapping', 'BPMN', 'UAT', 'wireframe', 'SWOT', 'as-is', 'to-be', 'traceability matrix'],
  },

  // ── Finance · Accounting · Risk ────────────────────────────────────────────
  finance_kyc: {
    triggers: ['kyc', 'aml', 'compliance', 'due diligence', 'fenergo', 'regulatory', 'sanction',
      'financial crime', 'onboarding analyst'],
    terms: ['KYC', 'AML', 'CDD', 'EDD', 'PEP', 'UBO', 'beneficial ownership', 'sanctions screening',
      'adverse media', 'FATF', 'SAR', 'STR', 'transaction monitoring', 'remediation', 'Fenergo',
      'Actimize', 'due diligence', 'risk rating', 'regulatory reporting', 'FATCA', 'AML/CFT'],
  },
  finance_corp: {
    triggers: ['finance', 'investment', 'equity', 'valuation', 'trading', 'portfolio', 'investment banking',
      'financial analyst', 'private equity', 'hedge fund'],
    terms: ['DCF', 'NPV', 'IRR', 'EBITDA', 'WACC', 'P/E ratio', 'balance sheet', 'cash flow',
      'hedging', 'derivatives', 'equity research', 'due diligence', 'portfolio', 'liquidity', 'LBO',
      'M&A', 'working capital', 'CAPM', 'yield'],
  },
  accounting: {
    triggers: ['accountant', 'accounting', 'bookkeeping', 'audit', 'tax', 'cpa', 'accounts payable',
      'accounts receivable'],
    terms: ['GAAP', 'IFRS', 'accounts payable', 'accounts receivable', 'general ledger', 'reconciliation',
      'accruals', 'depreciation', 'amortization', 'trial balance', 'P&L', 'balance sheet', 'audit trail',
      'CPA', 'journal entry', 'QuickBooks', 'SAP', 'month-end close'],
  },
  insurance: {
    triggers: ['insurance', 'underwriting', 'actuary', 'claims', 'policyholder', 'reinsurance'],
    terms: ['underwriting', 'actuary', 'premium', 'claims', 'reinsurance', 'policyholder', 'deductible',
      'loss ratio', 'annuity', 'liability', 'indemnity', 'peril', 'endorsement', 'subrogation', 'IRDAI'],
  },

  // ── Marketing · Sales · HR ─────────────────────────────────────────────────
  marketing: {
    triggers: ['marketing', 'digital marketing', 'seo', 'brand', 'content marketing', 'social media',
      'campaign', 'growth marketing'],
    terms: ['SEO', 'SEM', 'PPC', 'CTR', 'CPC', 'CPM', 'ROAS', 'CAC', 'LTV', 'conversion rate',
      'Google Analytics', 'Google Ads', 'HubSpot', 'attribution', 'funnel', 'lead generation',
      'A/B testing', 'organic reach', 'impressions', 'retargeting', 'email marketing'],
  },
  sales: {
    triggers: ['sales', 'account executive', 'business development', 'bdr', 'sdr', 'quota', 'crm',
      'account manager'],
    terms: ['CRM', 'Salesforce', 'HubSpot', 'pipeline', 'quota', 'SQL', 'MQL', 'lead', 'prospecting',
      'cold calling', 'demo', 'upsell', 'cross-sell', 'churn', 'ARR', 'MRR', 'BANT', 'SPIN selling',
      'closing ratio', 'territory'],
  },
  hr_recruiting: {
    triggers: ['hr', 'human resources', 'recruiter', 'recruiting', 'talent acquisition', 'people ops',
      'hrbp', 'staffing'],
    terms: ['ATS', 'HRIS', 'onboarding', 'attrition', 'employer branding', 'talent acquisition',
      'sourcing', 'headcount', 'compensation', 'benefits', 'DEI', 'performance review', 'succession planning',
      'Workday', 'employee engagement', 'offer letter', 'HRBP'],
  },

  // ── Operations · Supply Chain · Customer ───────────────────────────────────
  operations: {
    triggers: ['operations', 'supply chain', 'logistics', 'procurement', 'inventory', 'warehouse',
      'manufacturing operations'],
    terms: ['supply chain', 'logistics', 'procurement', 'inventory', 'SKU', 'lead time', 'JIT',
      'Six Sigma', 'Lean', 'Kaizen', 'ERP', 'SAP', 'demand forecasting', 'fulfillment', 'OTIF',
      'bottleneck', 'throughput', 'cycle time', 'vendor management'],
  },
  customer_service: {
    triggers: ['customer service', 'customer support', 'call center', 'help desk', 'customer success',
      'contact center'],
    terms: ['CSAT', 'NPS', 'SLA', 'ticket', 'escalation', 'first call resolution', 'Zendesk',
      'Freshdesk', 'CRM', 'churn', 'onboarding', 'knowledge base', 'omnichannel', 'AHT', 'retention'],
  },
  ecommerce_retail: {
    triggers: ['retail', 'ecommerce', 'e-commerce', 'merchandising', 'store manager', 'shopify'],
    terms: ['GMV', 'AOV', 'conversion rate', 'SKU', 'merchandising', 'Shopify', 'inventory turnover',
      'planogram', 'point of sale', 'omnichannel', 'fulfillment', 'cart abandonment', 'footfall', 'markdown'],
  },

  // ── Healthcare · Life Sciences ─────────────────────────────────────────────
  medical: {
    triggers: ['doctor', 'physician', 'medical', 'clinical', 'hospital', 'patient', 'surgeon', 'md '],
    terms: ['diagnosis', 'prognosis', 'etiology', 'comorbidity', 'differential diagnosis', 'ICU',
      'triage', 'electronic health record', 'EHR', 'HIPAA', 'pathology', 'oncology', 'cardiology',
      'anesthesia', 'sepsis', 'hypertension', 'myocardial infarction', 'CT scan', 'MRI'],
  },
  nursing: {
    triggers: ['nurse', 'nursing', 'rn ', 'patient care', 'clinical nurse'],
    terms: ['vitals', 'triage', 'IV', 'catheter', 'medication administration', 'care plan', 'EHR',
      'HIPAA', 'wound care', 'BP', 'ICU', 'CPR', 'patient assessment', 'dosage', 'infection control',
      'RN', 'discharge'],
  },
  pharma_biotech: {
    triggers: ['pharma', 'pharmaceutical', 'biotech', 'clinical trial', 'life sciences', 'drug development',
      'regulatory affairs'],
    terms: ['clinical trial', 'FDA', 'GMP', 'GCP', 'IND', 'NDA', 'pharmacovigilance', 'protocol',
      'bioequivalence', 'placebo', 'Phase III', 'CRO', 'assay', 'formulation', 'efficacy', 'adverse event',
      'regulatory submission', 'ICH'],
  },
  mental_health: {
    triggers: ['therapist', 'counselor', 'psychologist', 'mental health', 'counseling', 'psychiatry',
      'social worker'],
    terms: ['CBT', 'DBT', 'psychotherapy', 'assessment', 'diagnosis', 'DSM-5', 'trauma-informed',
      'intervention', 'case management', 'crisis intervention', 'mindfulness', 'psychoeducation',
      'treatment plan', 'confidentiality'],
  },

  // ── Engineering (non-software) ─────────────────────────────────────────────
  mechanical_eng: {
    triggers: ['mechanical engineer', 'mechanical', 'cad', 'solidworks', 'manufacturing engineer',
      'design engineer', 'automotive'],
    terms: ['CAD', 'SolidWorks', 'AutoCAD', 'CATIA', 'FEA', 'CFD', 'GD&T', 'tolerance', 'thermodynamics',
      'CNC', 'HVAC', 'torque', 'fatigue analysis', 'BOM', 'ANSYS', 'stress analysis', 'kinematics'],
  },
  electrical_eng: {
    triggers: ['electrical engineer', 'electrical', 'electronics', 'embedded', 'pcb', 'power systems'],
    terms: ['PCB', 'VLSI', 'FPGA', 'microcontroller', 'PLC', 'SCADA', 'oscilloscope', 'MOSFET',
      'impedance', 'signal processing', 'analog', 'embedded systems', 'firmware', 'Verilog', 'schematic',
      'power electronics'],
  },
  civil_construction: {
    triggers: ['civil engineer', 'construction', 'structural', 'site engineer', 'architect',
      'quantity surveyor'],
    terms: ['AutoCAD', 'BIM', 'Revit', 'structural analysis', 'reinforcement', 'load bearing', 'STAAD',
      'geotechnical', 'surveying', 'BOQ', 'RCC', 'formwork', 'estimation', 'site supervision',
      'foundation', 'concrete mix'],
  },
  energy: {
    triggers: ['oil and gas', 'energy', 'petroleum', 'renewable', 'solar', 'power plant', 'drilling'],
    terms: ['upstream', 'downstream', 'drilling', 'reservoir', 'refinery', 'pipeline', 'photovoltaic',
      'turbine', 'grid', 'HSE', 'wellbore', 'hydrocarbon', 'LNG', 'kilowatt', 'substation', 'renewables'],
  },

  // ── Law · Education · Media · Hospitality ──────────────────────────────────
  legal: {
    triggers: ['lawyer', 'attorney', 'legal', 'paralegal', 'litigation', 'counsel', 'law firm',
      'compliance officer'],
    terms: ['litigation', 'due diligence', 'contract', 'plaintiff', 'defendant', 'deposition', 'tort',
      'liability', 'indemnity', 'jurisdiction', 'precedent', 'statute', 'affidavit', 'discovery',
      'intellectual property', 'NDA', 'arbitration', 'compliance', 'GDPR'],
  },
  education: {
    triggers: ['teacher', 'teaching', 'educator', 'professor', 'lecturer', 'tutor', 'instructor',
      'curriculum', 'faculty'],
    terms: ['curriculum', 'pedagogy', 'lesson plan', 'assessment', 'formative assessment', 'differentiation',
      'IEP', 'learning outcomes', 'Bloom\'s taxonomy', 'classroom management', 'rubric', 'scaffolding',
      'LMS', 'engagement', 'blended learning'],
  },
  media: {
    triggers: ['journalist', 'journalism', 'editor', 'reporter', 'media', 'public relations', 'pr ',
      'content writer', 'copywriter'],
    terms: ['byline', 'lede', 'editorial', 'press release', 'embargo', 'SEO', 'CMS', 'copywriting',
      'AP style', 'newsroom', 'op-ed', 'sound bite', 'circulation', 'fact-checking', 'media kit',
      'earned media'],
  },
  hospitality: {
    triggers: ['hospitality', 'hotel', 'restaurant', 'chef', 'front desk', 'tourism', 'guest services',
      'food and beverage'],
    terms: ['occupancy rate', 'RevPAR', 'ADR', 'front desk', 'concierge', 'F&B', 'guest satisfaction',
      'POS', 'housekeeping', 'banquet', 'check-in', 'upselling', 'PMS', 'mise en place', 'covers'],
  },
};

const norm = (s) => ` ${String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;

// Decide which domain banks apply, ranked by how many triggers hit. Matching is
// WHOLE-WORD (space-padded) so "AML" doesn't false-match the "ml" trigger and
// "ai" doesn't match inside "email"/"available". Returns the top 2 domains'
// term lists (2 max, to respect the token budget).
function matchedDomains(contextText) {
  const hay = norm(contextText);
  const scored = [];
  for (const [name, def] of Object.entries(DOMAINS)) {
    let score = 0;
    for (const t of def.triggers) {
      const trig = ` ${t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
      if (hay.includes(trig)) score++;
    }
    if (score > 0) scored.push({ name, score, terms: def.terms });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 2);
}

// Build the comma-separated keyword hint (detected domains + universal set),
// deduped and capped to a safe character budget so Whisper's prompt stays under
// its token limit. `maxChars` leaves room for the user's own hints + a context
// slice that transcriptionEngine appends.
function buildKeywordHint(contextText, maxChars = 520) {
  const domains = matchedDomains(contextText);
  const terms = [];
  for (const d of domains) terms.push(...d.terms); // domain terms first (most valuable)
  terms.push(...UNIVERSAL);
  const seen = new Set();
  const out = [];
  let len = 0;
  for (const term of terms) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const add = (out.length ? 2 : 0) + term.length;
    if (len + add > maxChars) break;
    out.push(term);
    len += add;
  }
  return { hint: out.join(', '), domains: domains.map((d) => d.name) };
}

module.exports = { buildKeywordHint, matchedDomains, UNIVERSAL, DOMAINS };
