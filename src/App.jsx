import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Pause, Square, Sliders, Settings, Activity, FileText, 
  CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp, 
  Loader2, Send, Sparkles, BarChart3, HelpCircle, User, MessageSquare, AlertCircle
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';

// Color palette for charts
const CHART_COLORS = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function App() {
  const [activeTab, setActiveTab] = useState('setup'); // 'setup', 'config', 'execution'
  const [formUrl, setFormUrl] = useState('https://docs.google.com/forms/d/e/1FAIpQLSckYUDbyreLwZxOvwC-eQ5DRsqL7M5OtnfeByKmBkxi6ApN0g/viewform');
  const [parsing, setParsing] = useState(false);
  const [parsedForm, setParsedForm] = useState(null);
  
  // Rules configuration: { [entryId]: ruleConfig }
  const [rules, setRules] = useState({});
  const [expandedQuestionId, setExpandedQuestionId] = useState(null);
  
  // Execution state
  const [totalCount, setTotalCount] = useState(100);
  const [delayMin, setDelayMin] = useState(2);
  const [delayMax, setDelayMax] = useState(5);
  const [executionStatus, setExecutionStatus] = useState('idle'); // 'idle', 'running', 'paused', 'stopped', 'completed'
  const [progress, setProgress] = useState({ total: 0, completed: 0, successCount: 0, errorCount: 0 });
  const [logs, setLogs] = useState([]);
  const [statistics, setStatistics] = useState({});
  const [selectedStatQuestion, setSelectedStatQuestion] = useState('');
  
  const sseRef = useRef(null);

  // Parse Google Form URL
  const handleParseForm = async () => {
    if (!formUrl) {
      alert('Vui lòng nhập link Google Form');
      return;
    }
    setParsing(true);
    setParsedForm(null);
    try {
      const response = await fetch(`http://localhost:5000/api/parse?url=${encodeURIComponent(formUrl)}`);
      const data = await response.json();
      
      if (data.error) {
        alert(data.error);
        return;
      }
      
      setParsedForm(data);
      initializeDefaultRules(data.questions);
      setActiveTab('config'); // Auto-switch to config tab
    } catch (err) {
      alert('Không thể kết nối đến server backend. Hãy chắc chắn server đang chạy trên cổng 5000.');
      console.error(err);
    } finally {
      setParsing(false);
    }
  };

  // Initialize default rules based on question types and keywords
  const initializeDefaultRules = (questions) => {
    const initialRules = {};
    let firstInputEntryId = '';

    questions.forEach(q => {
      if (!q.isInput) return;
      
      if (!firstInputEntryId && q.entryId) {
        firstInputEntryId = q.entryId;
      }

      const titleLower = q.title.toLowerCase();
      let mode = 'random';
      let fixedValue = '';
      
      // Auto-detect Vietnamese name fields
      if (titleLower.includes('tên của bạn') || titleLower.includes('họ và tên') || titleLower.includes('họ tên') || titleLower.includes('tên anh/chị')) {
        mode = 'text_name';
      }
      // Auto-detect Vietnamese feedback/comment fields
      else if (titleLower.includes('góp ý') || titleLower.includes('nhận xét') || titleLower.includes('ý kiến') || titleLower.includes('phản hồi')) {
        mode = 'text_feedback';
      }
      // Auto-detect Attention Checks
      else if (
        titleLower.includes('chú ý') || 
        titleLower.includes('yêu cầu') || 
        titleLower.includes('chọn số') || 
        titleLower.includes('chọn câu') ||
        titleLower.includes('chọn giá trị') ||
        titleLower.includes('lớn nhất') ||
        titleLower.includes('nhỏ nhất')
      ) {
        mode = 'fixed';
        // Guess the correct option based on options content (e.g. if looking for smallest number, look for "1" or min value)
        if (q.options && q.options.length > 0) {
          if (titleLower.includes('lớn nhất')) {
            // Find option with largest number
            const numbers = q.options.map(o => parseInt(o)).filter(n => !isNaN(n));
            if (numbers.length > 0) {
              fixedValue = Math.max(...numbers).toString();
            } else {
              fixedValue = q.options[q.options.length - 1];
            }
          } else if (titleLower.includes('nhỏ nhất') || titleLower.includes('thấp nhất')) {
            // Find option with smallest number
            const numbers = q.options.map(o => parseInt(o)).filter(n => !isNaN(n));
            if (numbers.length > 0) {
              fixedValue = Math.min(...numbers).toString();
            } else {
              fixedValue = q.options[0];
            }
          } else {
            fixedValue = q.options[0];
          }
        }
      }

      // Initialize option weights to equal distribution
      const weights = {};
      if (q.options && q.options.length > 0) {
        const equalPct = Math.round(100 / q.options.length);
        q.options.forEach(opt => {
          weights[opt] = equalPct;
        });
      }

      if (q.type === 'grid') {
        // Grid contains multiple rows
        initialRules[q.id] = {
          title: q.title,
          type: q.type,
          mode: 'random',
          rows: q.rows,
          columns: q.columns,
          fixedValue: q.columns[0] || '',
          weights: q.columns.reduce((acc, col) => {
            acc[col] = Math.round(100 / q.columns.length);
            return acc;
          }, {})
        };
      } else {
        initialRules[q.entryId] = {
          title: q.title,
          type: q.type,
          mode: mode,
          options: q.options || [],
          weights: weights,
          fixedValue: fixedValue || (q.options && q.options[0]) || '',
          minChecked: 1,
          maxChecked: q.options ? Math.min(3, q.options.length) : 1
        };
      }
    });

    setRules(initialRules);
    setSelectedStatQuestion(firstInputEntryId);
  };

  // Sync state from active SSE session or fetch on mount
  useEffect(() => {
    fetchSessionStatus();
    return () => {
      if (sseRef.current) {
        sseRef.current.close();
      }
    };
  }, []);

  const fetchSessionStatus = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/session-status');
      const data = await response.json();
      if (data.status && data.status !== 'idle') {
        setExecutionStatus(data.status);
        setTotalCount(data.total);
        setProgress({
          total: data.total,
          completed: data.completed,
          successCount: data.successCount,
          errorCount: data.errorCount
        });
        setLogs(data.logs);
        setStatistics(data.statistics || {});
        connectProgressSSE();
      }
    } catch (err) {
      console.warn('Backend server not running yet.', err);
    }
  };

  // Connect to Server-Sent Events for real-time progress
  const connectProgressSSE = () => {
    if (sseRef.current) {
      sseRef.current.close();
    }

    const eventSource = new EventSource('http://localhost:5000/api/session-progress');
    sseRef.current = eventSource;

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.state) {
        setExecutionStatus(data.state.status);
        setProgress({
          total: data.state.total,
          completed: data.state.completed,
          successCount: data.state.successCount,
          errorCount: data.state.errorCount
        });
        setStatistics(data.state.statistics || {});
      }
      if (data.logs) {
        setLogs(data.logs);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE Error:', err);
      eventSource.close();
    };
  };

  // Start generation run
  const handleStartGeneration = async () => {
    if (!parsedForm) {
      alert('Vui lòng parse Google Form thành công trước.');
      return;
    }
    
    // Validate custom weights sum up to 100
    for (const entryId of Object.keys(rules)) {
      const rule = rules[entryId];
      if (rule.mode === 'weights' && rule.type !== 'grid') {
        const sum = Object.values(rule.weights).reduce((a, b) => a + b, 0);
        if (sum !== 100) {
          alert(`Lỗi: Tổng tỷ trọng của câu hỏi "${rule.title.substring(0, 30)}..." là ${sum}%. Phải bằng đúng 100%.`);
          setExpandedQuestionId(parsedForm.questions.find(q => q.entryId === parseInt(entryId) || q.id === parseInt(entryId))?.id);
          setActiveTab('config');
          return;
        }
      }
    }

    try {
      const response = await fetch('http://localhost:5000/api/start-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formUrl: formUrl,
          submitUrl: parsedForm.submitUrl,
          rules: rules,
          totalCount: totalCount,
          delayMin: delayMin * 1000,
          delayMax: delayMax * 1000,
          pagesCount: parsedForm.pagesCount
        })
      });
      
      const data = await response.json();
      if (data.success) {
        setExecutionStatus('running');
        setLogs([]);
        setStatistics({});
        connectProgressSSE();
        setActiveTab('execution');
      } else {
        alert('Không thể bắt đầu phiên chạy: ' + data.error);
      }
    } catch (err) {
      alert('Lỗi gửi request bắt đầu chạy: ' + err.message);
    }
  };

  // Controller Actions
  const handlePauseGeneration = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/pause-session', { method: 'POST' });
      const data = await res.json();
      if (data.success) setExecutionStatus('paused');
    } catch (err) { alert(err.message); }
  };

  const handleResumeGeneration = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/resume-session', { method: 'POST' });
      const data = await res.json();
      if (data.success) setExecutionStatus('running');
    } catch (err) { alert(err.message); }
  };

  const handleStopGeneration = async () => {
    if (confirm('Bạn có chắc muốn hủy phiên chạy này không?')) {
      try {
        const res = await fetch('http://localhost:5000/api/stop-session', { method: 'POST' });
        const data = await res.json();
        if (data.success) setExecutionStatus('stopped');
      } catch (err) { alert(err.message); }
    }
  };

  // Helper to balance weights to exactly 100
  const autoBalanceWeights = (entryId, targetOption) => {
    const newRules = { ...rules };
    const rule = newRules[entryId];
    const targetVal = rule.weights[targetOption];
    const otherOptions = Object.keys(rule.weights).filter(o => o !== targetOption);
    
    if (otherOptions.length === 0) {
      rule.weights[targetOption] = 100;
      setRules(newRules);
      return;
    }

    const remaining = 100 - targetVal;
    if (remaining < 0) {
      rule.weights[targetOption] = 100;
      otherOptions.forEach(o => { rule.weights[o] = 0; });
    } else {
      const baseShare = Math.floor(remaining / otherOptions.length);
      let remainder = remaining % otherOptions.length;
      otherOptions.forEach((o, idx) => {
        rule.weights[o] = baseShare + (idx < remainder ? 1 : 0);
      });
    }
    setRules(newRules);
  };

  // Update a single weight value
  const handleWeightChange = (entryId, option, val) => {
    const newRules = { ...rules };
    newRules[entryId].weights[option] = parseInt(val) || 0;
    setRules(newRules);
  };

  // Update rule settings
  const handleRuleConfigChange = (entryId, key, value) => {
    const newRules = { ...rules };
    newRules[entryId][key] = value;
    setRules(newRules);
  };

  // Format Recharts statistics data
  const getChartData = () => {
    if (!selectedStatQuestion || !statistics[selectedStatQuestion]) return [];
    
    const questionStats = statistics[selectedStatQuestion];
    const rule = rules[selectedStatQuestion];
    
    if (!rule) return [];
    
    // Check if it's grid stats or normal stats
    if (rule.type === 'grid') {
      // For grid, let's aggregate stats across rows or show row names
      return Object.keys(questionStats).map(rowTitle => {
        const rowData = questionStats[rowTitle];
        // Find column with max votes
        let maxCol = 'Chưa có';
        let maxCount = 0;
        Object.keys(rowData).forEach(col => {
          if (rowData[col] > maxCount) {
            maxCount = rowData[col];
            maxCol = col;
          }
        });
        return {
          name: rowTitle.substring(0, 15) + '...',
          'Lựa chọn nhiều nhất': maxCount,
          label: `${maxCol} (${maxCount})`
        };
      });
    }

    return Object.keys(questionStats).map(optionName => ({
      name: optionName,
      'Số câu trả lời': questionStats[optionName]
    }));
  };

  const chartData = getChartData();
  const progressPercentage = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="container">
      {/* Header Panel */}
      <header className="header glass-panel" style={{ padding: '20px 30px', borderRadius: '20px' }}>
        <div className="brand">
          <div className="logo-icon">
            <Sparkles size={24} />
          </div>
          <div>
            <h1 className="brand-glow" style={{ fontSize: '1.6rem', fontWeight: '800' }}>SurveyFlow AI</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Hệ thống tạo mẫu khảo sát Google Forms tự động</p>
          </div>
        </div>

        {/* Tab Navigator */}
        <div className="tabs-container">
          <button 
            className={`tab-btn ${activeTab === 'setup' ? 'active' : ''}`}
            onClick={() => setActiveTab('setup')}
          >
            <Settings size={16} /> Thiết lập Form
          </button>
          <button 
            className={`tab-btn ${activeTab === 'config' ? 'active' : ''}`}
            disabled={!parsedForm}
            onClick={() => setActiveTab('config')}
          >
            <Sliders size={16} /> Cấu hình câu hỏi
          </button>
          <button 
            className={`tab-btn ${activeTab === 'execution' ? 'active' : ''}`}
            disabled={!parsedForm && executionStatus === 'idle'}
            onClick={() => setActiveTab('execution')}
          >
            <Activity size={16} /> Tiến trình chạy
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ minHeight: '60vh' }}>
        
        {/* TAB 1: FORM SETUP */}
        {activeTab === 'setup' && (
          <div className="glass-panel" style={{ padding: '40px', display: 'flex', flexDirection: 'column', gap: '30px' }}>
            <div style={{ textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
              <h2 style={{ fontSize: '2rem', marginBottom: '10px' }}>Nhập Google Form cần chạy</h2>
              <p style={{ color: 'var(--text-muted)' }}>
                Dán đường dẫn link Google Form của bạn bên dưới. Hệ thống sẽ tự động quét toàn bộ câu hỏi, 
                phân loại và trích xuất mã trường (entry ID) cần thiết để gửi phản hồi.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '15px', maxWidth: '800px', width: '100%', margin: '0 auto' }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <input 
                  type="text" 
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="https://docs.google.com/forms/d/e/.../viewform"
                  style={{ paddingLeft: '45px', fontSize: '1rem' }}
                />
                <FileText size={20} style={{ position: 'absolute', left: '16px', top: '15px', color: 'var(--text-muted)' }} />
              </div>
              <button 
                className="btn btn-primary"
                onClick={handleParseForm}
                disabled={parsing}
                style={{ minWidth: '150px' }}
              >
                {parsing ? (
                  <>
                    <Loader2 className="animate-spin" size={18} /> Đang quét...
                  </>
                ) : (
                  <>
                    <Send size={18} /> Quét Form
                  </>
                )}
              </button>
            </div>

            {parsedForm && (
              <div className="glass-panel" style={{ padding: '24px', background: 'rgba(255, 255, 255, 0.02)', maxWidth: '800px', width: '100%', margin: '20px auto 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '15px' }}>
                  <div>
                    <h3 style={{ color: 'var(--accent-secondary)' }}>{parsedForm.title}</h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {parsedForm.description || 'Không có mô tả.'}
                    </p>
                  </div>
                  <span className="badge badge-info">
                    {parsedForm.questions.filter(q => q.isInput).length} câu hỏi
                  </span>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  <div>
                    <strong>Cổng nộp:</strong> <code style={{ color: '#c084fc' }}>/formResponse</code>
                  </div>
                  <div>
                    <strong>Mã Form Token (fbzx):</strong> <code>{parsedForm.fbzx || 'Tự động tạo'}</code>
                  </div>
                  <div>
                    <strong>Số trang/phần:</strong> <code>{parsedForm.pagesCount} trang</code>
                  </div>
                  <div>
                    <strong>Trạng thái quét:</strong> <span style={{ color: 'var(--accent-success)' }}>Sẵn sàng</span>
                  </div>
                </div>

                <div style={{ marginTop: '20px', textAlign: 'right' }}>
                  <button className="btn btn-secondary" onClick={() => setActiveTab('config')}>
                    Tiếp tục: Cấu hình quy luật &rarr;
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: QUESTIONS CONFIGURATION */}
        {activeTab === 'config' && parsedForm && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '24px' }}>
            
            {/* List of questions */}
            <div className="glass-panel" style={{ padding: '20px' }}>
              <div style={{ marginBottom: '20px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '15px' }}>
                <h2>Cấu hình quy luật tạo dữ liệu</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  Tùy chỉnh cách bot chọn đáp án cho từng câu hỏi. Bạn có thể chọn ngẫu nhiên đồng đều, 
                  phân bổ tỷ lệ phần trăm (đáp án mong muốn), hoặc điền cố định (để vượt qua câu hỏi kiểm tra sự chú ý).
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {parsedForm.questions.map((q) => {
                  const isExpanded = expandedQuestionId === q.id;
                  
                  // Section or Info Header
                  if (!q.isInput) {
                    return (
                      <div 
                        key={q.id} 
                        style={{ 
                          padding: '12px 20px', 
                          background: q.type === 'section' ? 'rgba(99, 102, 241, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                          borderLeft: q.type === 'section' ? '3px solid var(--accent-primary)' : '1px solid var(--glass-border)',
                          borderRadius: '8px', 
                          margin: '10px 0 5px 0' 
                        }}
                      >
                        <strong style={{ 
                          color: q.type === 'section' ? 'var(--text-title)' : 'var(--text-muted)',
                          fontSize: q.type === 'section' ? '0.95rem' : '0.85rem'
                        }}>
                          {q.type === 'section' ? `📂 Phần: ${q.title}` : `ℹ️ ${q.title}`}
                        </strong>
                        {q.description && (
                          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                            {q.description}
                          </p>
                        )}
                      </div>
                    );
                  }

                  const ruleKey = q.type === 'grid' ? q.id : q.entryId;
                  const rule = rules[ruleKey];
                  if (!rule) return null;

                  return (
                    <div 
                      key={q.id} 
                      className={`glass-panel accordion ${isExpanded ? 'glass-panel-glow' : ''}`}
                      style={{ borderRadius: '12px', overflow: 'hidden' }}
                    >
                      <div 
                        className="accordion-header" 
                        onClick={() => setExpandedQuestionId(isExpanded ? null : q.id)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                          <span className={`badge ${
                            rule.mode === 'weights' ? 'badge-info' : 
                            rule.mode === 'fixed' ? 'badge-warning' : 
                            rule.mode.startsWith('text') ? 'badge-success' : 'badge-info'
                          }`} style={{ opacity: 0.8 }}>
                            {rule.mode === 'weights' ? 'Tỷ trọng %' : 
                             rule.mode === 'fixed' ? 'Cố định' : 
                             rule.mode === 'text_name' ? 'Tên VN' : 
                             rule.mode === 'text_feedback' ? 'Ý kiến' : 'Ngẫu nhiên'}
                          </span>
                          <span style={{ fontWeight: '600', fontSize: '0.95rem', color: 'var(--text-title)' }}>
                            {q.title}
                          </span>
                          {q.required && <span style={{ color: 'var(--accent-danger)' }}>*</span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {q.type === 'multiple_choice' ? '1 Lựa chọn' :
                             q.type === 'checkbox' ? 'Nhiều lựa chọn' :
                             q.type === 'linear_scale' ? 'Thang điểm' : 
                             q.type === 'grid' ? 'Bảng lưới' : 'Nhập chữ'}
                          </span>
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="accordion-body">
                          <div style={{ marginBottom: '15px', display: 'flex', gap: '20px', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Phương thức tạo:</span>
                            <div style={{ display: 'flex', gap: '10px' }}>
                              
                              {/* Text question modes */}
                              {(q.type === 'short_text' || q.type === 'long_text') ? (
                                <>
                                  <button 
                                    className={`btn btn-secondary ${rule.mode === 'text_name' ? 'active' : ''}`}
                                    style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                                    onClick={() => handleRuleConfigChange(ruleKey, 'mode', 'text_name')}
                                  >
                                    <User size={14} /> Tên tiếng Việt
                                  </button>
                                  <button 
                                    className={`btn btn-secondary ${rule.mode === 'text_feedback' ? 'active' : ''}`}
                                    style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                                    onClick={() => handleRuleConfigChange(ruleKey, 'mode', 'text_feedback')}
                                  >
                                    <MessageSquare size={14} /> Ý kiến ngẫu nhiên
                                  </button>
                                  <button 
                                    className={`btn btn-secondary ${rule.mode === 'fixed' ? 'active' : ''}`}
                                    style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                                    onClick={() => handleRuleConfigChange(ruleKey, 'mode', 'fixed')}
                                  >
                                    Cố định văn bản
                                  </button>
                                </>
                              ) : (
                                // Multiple choices modes
                                <>
                                  <button 
                                    className={`btn btn-secondary ${rule.mode === 'random' ? 'active' : ''}`}
                                    style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                                    onClick={() => handleRuleConfigChange(ruleKey, 'mode', 'random')}
                                  >
                                    Ngẫu nhiên đồng đều
                                  </button>
                                  <button 
                                    className={`btn btn-secondary ${rule.mode === 'weights' ? 'active' : ''}`}
                                    style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                                    onClick={() => handleRuleConfigChange(ruleKey, 'mode', 'weights')}
                                  >
                                    Tỷ trọng % tùy chỉnh
                                  </button>
                                  <button 
                                    className={`btn btn-secondary ${rule.mode === 'fixed' ? 'active' : ''}`}
                                    style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                                    onClick={() => handleRuleConfigChange(ruleKey, 'mode', 'fixed')}
                                  >
                                    Cố định 1 giá trị
                                  </button>
                                </>
                              )}

                              {q.type === 'checkbox' && (
                                <button 
                                  className={`btn btn-secondary ${rule.mode === 'checkbox_random' ? 'active' : ''}`}
                                  style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                                  onClick={() => handleRuleConfigChange(ruleKey, 'mode', 'checkbox_random')}
                                >
                                  Ngẫu nhiên chọn nhiều
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Mode Config UI details */}
                          {rule.mode === 'fixed' && (
                            <div style={{ marginTop: '10px' }}>
                              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Giá trị cố định sẽ nộp:</span>
                              {(q.type === 'short_text' || q.type === 'long_text') ? (
                                <input 
                                  type="text" 
                                  value={rule.fixedValue}
                                  onChange={(e) => handleRuleConfigChange(ruleKey, 'fixedValue', e.target.value)}
                                  placeholder="Nhập chuỗi văn bản..."
                                  style={{ marginTop: '5px' }}
                                />
                              ) : (
                                <select 
                                  value={rule.fixedValue}
                                  onChange={(e) => handleRuleConfigChange(ruleKey, 'fixedValue', e.target.value)}
                                  style={{ marginTop: '5px' }}
                                >
                                  {rule.options && rule.options.map((opt, i) => (
                                    <option key={i} value={opt}>{opt}</option>
                                  ))}
                                  {rule.columns && rule.columns.map((opt, i) => (
                                    <option key={i} value={opt}>{opt}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          )}

                          {rule.mode === 'checkbox_random' && q.type === 'checkbox' && (
                            <div style={{ display: 'flex', gap: '20px', marginTop: '10px' }}>
                              <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Số đáp án chọn tối thiểu:</label>
                                <input 
                                  type="number" 
                                  min={1} 
                                  max={rule.options.length} 
                                  value={rule.minChecked}
                                  onChange={(e) => handleRuleConfigChange(ruleKey, 'minChecked', parseInt(e.target.value) || 1)}
                                  style={{ marginTop: '5px' }}
                                />
                              </div>
                              <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Số đáp án chọn tối đa:</label>
                                <input 
                                  type="number" 
                                  min={1} 
                                  max={rule.options.length} 
                                  value={rule.maxChecked}
                                  onChange={(e) => handleRuleConfigChange(ruleKey, 'maxChecked', parseInt(e.target.value) || 1)}
                                  style={{ marginTop: '5px' }}
                                />
                              </div>
                            </div>
                          )}

                          {rule.mode === 'weights' && (
                            <div style={{ marginTop: '15px', background: 'rgba(0,0,0,0.1)', padding: '15px', borderRadius: '10px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Điều chỉnh phân bổ tỷ lệ (%):</span>
                                <span className={`badge ${
                                  Object.values(rule.weights).reduce((a, b) => a + b, 0) === 100 ? 'badge-success' : 'badge-danger'
                                }`}>
                                  Tổng: {Object.values(rule.weights).reduce((a, b) => a + b, 0)}% / 100%
                                </span>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {(rule.options || rule.columns || []).map((opt) => (
                                  <div key={opt} style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                    <span style={{ width: '150px', fontSize: '0.85rem', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={opt}>
                                      {opt}
                                    </span>
                                    <input 
                                      type="range" 
                                      min="0" 
                                      max="100" 
                                      value={rule.weights[opt] || 0}
                                      onChange={(e) => handleWeightChange(ruleKey, opt, e.target.value)}
                                      style={{ flex: 1 }}
                                    />
                                    <span style={{ width: '40px', textAlign: 'right', fontSize: '0.85rem', fontWeight: '600' }}>
                                      {rule.weights[opt] || 0}%
                                    </span>
                                    <button 
                                      className="btn btn-secondary"
                                      style={{ padding: '4px 8px', fontSize: '0.75rem', borderRadius: '6px' }}
                                      onClick={() => autoBalanceWeights(ruleKey, opt)}
                                      title="Tự động cân bằng các giá trị còn lại"
                                    >
                                      Cân bằng
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {rule.mode === 'text_name' && (
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px', background: 'rgba(16,185,129,0.05)', padding: '10px', borderRadius: '8px' }}>
                              <User size={16} style={{ color: 'var(--accent-success)' }} />
                              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                Hệ thống sẽ tự động ghép Họ + Tên đệm + Tên người Việt Nam ngẫu nhiên dựa trên phân bổ giới tính được chọn ở các trường khác.
                              </span>
                            </div>
                          )}

                          {rule.mode === 'text_feedback' && (
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px', background: 'rgba(16,185,129,0.05)', padding: '10px', borderRadius: '8px' }}>
                              <MessageSquare size={16} style={{ color: 'var(--accent-success)' }} />
                              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                Hệ thống sẽ sinh ngẫu nhiên các câu nhận xét khảo sát bằng tiếng Việt thực tế.
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Run parameters panel */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="glass-panel" style={{ padding: '24px' }}>
                <h3 style={{ marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Settings size={18} /> Thiết lập chạy
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>
                      Số lượng cần tạo:
                    </label>
                    <input 
                      type="number" 
                      min={1} 
                      value={totalCount}
                      onChange={(e) => setTotalCount(parseInt(e.target.value) || 10)}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>
                      Trễ tối thiểu (giây):
                    </label>
                    <input 
                      type="number" 
                      min={0} 
                      step={0.5}
                      value={delayMin}
                      onChange={(e) => setDelayMin(parseFloat(e.target.value) || 1)}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>
                      Trễ tối đa (giây):
                    </label>
                    <input 
                      type="number" 
                      min={delayMin} 
                      step={0.5}
                      value={delayMax}
                      onChange={(e) => setDelayMax(parseFloat(e.target.value) || 2)}
                    />
                  </div>
                  
                  <div style={{ background: 'rgba(245,158,11,0.05)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(245,158,11,0.1)', fontSize: '0.8rem', color: 'var(--accent-warning)', display: 'flex', gap: '8px' }}>
                    <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                    <span>Nên đặt độ trễ ngẫu nhiên từ 1-4 giây để giống người điền thật và tránh bị Google khóa gửi mẫu.</span>
                  </div>

                  <button 
                    className="btn btn-primary" 
                    onClick={handleStartGeneration}
                    style={{ marginTop: '10px', padding: '12px' }}
                  >
                    <Play size={16} /> Bắt đầu chạy khảo sát
                  </button>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* TAB 3: EXECUTION CONSOLE & CHARTS */}
        {activeTab === 'execution' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* Status grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px' }}>
              <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Trạng thái</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                  <span className={`badge ${
                    executionStatus === 'running' ? 'badge-info' : 
                    executionStatus === 'paused' ? 'badge-warning' : 
                    executionStatus === 'completed' ? 'badge-success' : 'badge-danger'
                  }`}>
                    {executionStatus === 'running' ? 'Đang chạy' : 
                     executionStatus === 'paused' ? 'Tạm dừng' : 
                     executionStatus === 'completed' ? 'Hoàn thành' : 
                     executionStatus === 'stopped' ? 'Đã hủy' : 'Sẵn sàng'}
                  </span>
                  {executionStatus === 'running' && <Loader2 className="animate-spin" size={14} style={{ color: 'var(--accent-primary)' }} />}
                </div>
              </div>

              <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Tiến độ</span>
                <span style={{ fontSize: '1.4rem', fontWeight: 'bold' }}>
                  {progress.completed} / {progress.total} ({progressPercentage}%)
                </span>
              </div>

              <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Thành công</span>
                <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--accent-success)' }}>
                  {progress.successCount}
                </span>
              </div>

              <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Lỗi</span>
                <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--accent-danger)' }}>
                  {progress.errorCount}
                </span>
              </div>
            </div>

            {/* Controls Bar & Progress Bar */}
            <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {executionStatus === 'running' ? (
                    <button className="btn btn-secondary" onClick={handlePauseGeneration}>
                      <Pause size={14} /> Tạm dừng
                    </button>
                  ) : executionStatus === 'paused' ? (
                    <button className="btn btn-success" onClick={handleResumeGeneration}>
                      <Play size={14} /> Tiếp tục
                    </button>
                  ) : null}
                  
                  {(executionStatus === 'running' || executionStatus === 'paused') && (
                    <button className="btn btn-danger" onClick={handleStopGeneration}>
                      <Square size={14} /> Dừng hẳn
                    </button>
                  )}

                  {(executionStatus === 'completed' || executionStatus === 'stopped' || executionStatus === 'idle') && (
                    <button className="btn btn-primary" onClick={() => setActiveTab('config')}>
                      Quay lại cấu hình
                    </button>
                  )}
                </div>

                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Độ trễ thiết lập: {delayMin}s - {delayMax}s
                </div>
              </div>

              {/* Progress track bar */}
              <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', overflow: 'hidden' }}>
                <div style={{ 
                  width: `${progressPercentage}%`, 
                  height: '100%', 
                  background: 'linear-gradient(90deg, var(--accent-primary), var(--accent-secondary))', 
                  borderRadius: '10px',
                  boxShadow: '0 0 10px rgba(99, 102, 241, 0.5)',
                  transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)' 
                }} />
              </div>
            </div>

            {/* Split layout: Charts & Logs */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              
              {/* Real-time stats charts */}
              <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <BarChart3 size={18} /> Phân bố dữ liệu đã gửi
                  </h3>
                  {parsedForm && (
                    <select 
                      value={selectedStatQuestion} 
                      onChange={(e) => setSelectedStatQuestion(e.target.value)}
                      style={{ width: '200px', padding: '6px 12px', fontSize: '0.8rem', borderRadius: '8px' }}
                    >
                      {parsedForm.questions.filter(q => q.isInput).map(q => (
                        <option key={q.id} value={q.type === 'grid' ? q.id : q.entryId}>
                          {q.title.substring(0, 30)}...
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div style={{ flex: 1, minHeight: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={chartData}>
                        <XAxis dataKey="name" stroke="#9ca3af" fontSize={11} tickLine={false} />
                        <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey={rules[selectedStatQuestion]?.type === 'grid' ? 'Lựa chọn nhiều nhất' : 'Số câu trả lời'} radius={[4, 4, 0, 0]}>
                          {chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      <AlertCircle size={32} style={{ margin: '0 auto 10px', opacity: 0.5 }} />
                      <p>Chưa có dữ liệu thống kê để hiển thị biểu đồ.</p>
                      <p style={{ fontSize: '0.8rem', marginTop: '4px' }}>Các câu trả lời thành công sẽ hiển thị ở đây.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Logs terminal console */}
              <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <h3>Dòng log hoạt động (Live Logs)</h3>
                
                <div style={{ 
                  flex: 1, 
                  background: '#020617', 
                  border: '1px solid var(--glass-border)', 
                  borderRadius: '12px', 
                  padding: '15px', 
                  fontFamily: 'monospace', 
                  fontSize: '0.85rem', 
                  maxHeight: '320px', 
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  {logs.length > 0 ? (
                    logs.map((log, index) => (
                      <div key={index} style={{ display: 'flex', gap: '10px', lineHeight: '1.4' }}>
                        <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>[{log.timestamp}]</span>
                        <span style={{ 
                          color: log.type === 'success' ? '#10b981' : 
                                 log.type === 'error' ? '#ef4444' : 
                                 log.type === 'warning' ? '#f59e0b' : '#6366f1'
                        }}>
                          {log.text}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '50px' }}>
                      Đang đợi log từ server...
                    </div>
                  )}
                </div>
              </div>

            </div>

          </div>
        )}

      </main>

      <footer style={{ marginTop: '4rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
        <p>SurveyFlow AI &copy; 2026. Made with &hearts; for data quality simulation.</p>
      </footer>
    </div>
  );
}
