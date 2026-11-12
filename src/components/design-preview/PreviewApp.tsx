import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BookOpen, Check, ChevronDown, Cloud, Copy, Cpu, Files, Info, Languages, Layers3, Maximize2, Minus, Moon, Redo2, Sun, TerminalSquare, Upload, Undo2, X } from 'lucide-react';
import LinearPage from './LinearPage';
import FluentPage from './FluentPage';
import NotionPage from './NotionPage';
import ShadcnPage from './ShadcnPage';
import { demoFiles, demoProject, demoTasks, styleNames, tr, type DemoFile, type DemoProject, type PreviewAction, type PreviewLocale, type PreviewStage, type PreviewStyle } from './preview-data';
import './preview-app.css';

const keys = Object.keys(styleNames) as PreviewStyle[];
const components = { linear: LinearPage, fluent: FluentPage, notion: NotionPage, shadcn: ShadcnPage };

export default function PreviewApp({ initialStyle = 'linear' }: { initialStyle?: PreviewStyle }) {
  const [style, setStyle] = useState<PreviewStyle>(initialStyle);
  const [locale, setLocale] = useState<PreviewLocale>('zh');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => typeof window !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const [stage, setStage] = useState<PreviewStage>('presales');
  const [project, setProject] = useState(demoProject('zh'));
  const [files, setFiles] = useState(demoFiles('zh'));
  const [tasks, setTasks] = useState(demoTasks('zh'));
  const [notice, setNotice] = useState('');
  const [overlay, setOverlay] = useState<PreviewAction | null>(null);
  const [openedFile, setOpenedFile] = useState<DemoFile | null>(null);
  const [provider, setProvider] = useState('local');
  const [runtime, setRuntime] = useState('ollama');
  const [model, setModel] = useState('qwen3:14b');
  const [skillNames, setSkillNames] = useState<string[]>([]);
  const [enabledSkills, setEnabledSkills] = useState<string[]>([]);
  const [maximized, setMaximized] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const history = useRef<DemoProject[]>([]), future = useRef<DemoProject[]>([]);
  const upload = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const selected = new URLSearchParams(location.search).get('style');
    if (keys.includes(selected as PreviewStyle)) setStyle(selected as PreviewStyle);
    setIsDesktop(Boolean(window.bidDesktop));
    return window.bidDesktop?.onWindowState?.(state => setMaximized(Boolean(state.maximized)));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.previewStyle = style;
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    document.title = tr(locale, '售前解决方案工具', 'Presales Solution Tool');
    window.bidDesktop?.setLocale?.(locale);
  }, [locale, theme, style]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 4200);
    return () => clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    if (overlay || openedFile) {
      previousFocus.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
      previousFocus.current?.focus();
    }
  }, [overlay, openedFile]);
  const chooseStyle = (next: PreviewStyle) => {
    setStyle(next);
    const url = new URL(location.href); url.searchParams.set('style', next); historyReplace(url);
  };
  const changeLocale = () => {
    const next = locale === 'zh' ? 'en' : 'zh';
    const previousDefaults = demoProject(locale), nextDefaults = demoProject(next);
    setLocale(next);
    setProject(current => Object.fromEntries(Object.entries(current).map(([key,value]) => [key,value === previousDefaults[key as keyof DemoProject] ? nextDefaults[key as keyof DemoProject] : value])) as DemoProject);
    const previousFiles = demoFiles(locale), nextFiles = demoFiles(next);
    setFiles(current => current.map(file => file.name === previousFiles.find(item => item.id === file.id)?.name ? {...file,name:nextFiles.find(item => item.id === file.id)!.name} : file));
    setTasks(current => current.map(task => ({...task,title:demoTasks(next).find(item => item.id === task.id)?.title || task.title})));
  };
  const changeProject = (key: keyof DemoProject, value: string) => {
    history.current = [...history.current, project].slice(-3); future.current = [];
    setProject({ ...project, [key]: value }); setHistoryVersion(v => v + 1);
  };
  const undo = () => {
    const previous = history.current.pop(); if (!previous) return;
    future.current.push(project); setProject(previous); setHistoryVersion(v => v + 1);
  };
  const redo = () => {
    const next = future.current.pop(); if (!next) return;
    history.current.push(project); setProject(next); setHistoryVersion(v => v + 1);
  };
  const action = (next: PreviewAction) => {
    if (next === 'import') { upload.current?.click(); return; }
    if (next === 'generate' || next === 'export') { setNotice(tr(locale, '界面预览：未调用模型或生成文件。', 'UI preview: no model was called and no files were generated.')); return; }
    setOverlay(next);
  };
  const closeOverlay = () => { setOverlay(null); setOpenedFile(null); setCopied(false); };
  const copyText = async () => {
    try { await navigator.clipboard.writeText(document.querySelector('.pv-dialog-content')?.textContent?.trim() || ''); setCopied(true); }
    catch { setNotice(tr(locale, '可选中文字，按 Ctrl+C 复制。', 'Select the text and press Ctrl+C to copy.')); }
  };
  const shared = { locale, project, stage, files, tasks, onStageChange: setStage, onProjectChange: changeProject, onAction: action, onOpenFile: setOpenedFile, onTaskToggle: (id: string) => setTasks(current => current.map(task => task.id === id ? { ...task, done: !task.done } : task)) };
  const Page = components[style];
  const overlayTitles: Record<PreviewAction, string> = {
    import: tr(locale, '导入资料', 'Import materials'), generate: tr(locale, '生成方案', 'Generate proposal'), project: tr(locale, '项目设置', 'Project settings'), new: tr(locale, '新建项目', 'New project'), cleanup: tr(locale, '文件清理', 'File cleanup'), skills: 'Skills', models: tr(locale, '模型设置', 'Model settings'), communication: tr(locale, '新增沟通记录', 'Add meeting notes'), export: tr(locale, '输出文件', 'Export files'),
  };
  const field = (key: keyof DemoProject, label: string) => <label className="pv-field"><span>{label}</span><input className="pv-input" value={project[key]} onChange={event => changeProject(key, event.target.value)}/></label>;
  let overlayBody: ReactNode = null;
  if (openedFile) overlayBody = <><div className="pv-file-preview-heading"><Files size={32}/><div><strong>{openedFile.name}</strong><span>{openedFile.type} · {openedFile.size}</span></div></div><p>{tr(locale, '示例资料，仅用于比较四种界面。', 'Sample material for comparing the four interface designs.')}</p><h3>{tr(locale, '主要内容', 'Contents')}</h3><p>{project.objective}</p><p>{project.constraints}</p></>;
  else if (overlay === 'models') overlayBody = <div className="pv-dialog-fields">{provider === 'hybrid' ? <>{['资料分析','方案起草','文档识别'].map((name,index) => <label className="pv-field" key={name}><span>{tr(locale,name,['Material analysis','Proposal drafting','Document recognition'][index])}</span><select className="pv-input" defaultValue={index===0?'local':index===1?'plans':'api'}><option value="local">{tr(locale,'本地模型','Local model')}</option><option value="plans">{tr(locale,'模型套餐','Model plan')}</option><option value="api">API</option></select></label>)}</> : <><label className="pv-field"><span>{provider==='local'?tr(locale,'接入方式','Connection'):provider==='plans'?tr(locale,'套餐来源','Plan provider'):tr(locale,'接口协议','API protocol')}</span><select className="pv-input" value={provider==='local'?runtime:undefined} onChange={event => {if(provider==='local')setRuntime(event.target.value);}}>{provider==='local'?<><option value="ollama">Ollama</option><option value="lmstudio">LM Studio</option><option value="compatible">{tr(locale,'OpenAI 兼容服务','OpenAI compatible service')}</option></>:provider==='plans'?<>{['Codex','Claude','Grok','Gemini','DeepSeek','MiniMax'].map(name=><option key={name}>{name}</option>)}<option>{tr(locale,'其他兼容套餐','Other compatible plan')}</option></>:<><option>OpenAI Chat Completions</option><option>Anthropic Messages</option><option>Gemini GenerateContent</option></>}</select></label><label className="pv-field"><span>{tr(locale,'服务地址','Endpoint')}</span><input className="pv-input" key={provider} defaultValue={provider==='local'?'http://127.0.0.1:11434':''} placeholder={provider==='local'?'http://127.0.0.1:11434':'https://api.example.com/v1'}/></label><label className="pv-field"><span>{tr(locale,'模型名称','Model')}</span><input className="pv-input" value={model} onChange={event => setModel(event.target.value)}/></label><label className="pv-field"><span>{tr(locale,'访问令牌（可选）','Access token (optional)')}</span><input className="pv-input" type="password" autoComplete="off"/></label></>}<p className="pv-muted">{tr(locale,'界面预览，不会连接模型服务。','UI preview. No connection will be made.')}</p></div>;  else if (overlay === 'skills') overlayBody = <><div className="pv-skill-upload"><BookOpen size={30}/><strong>{tr(locale, '所有模型通道共用', 'Shared across all model modes')}</strong><label className="pv-button"><Upload size={16}/>{tr(locale, '选择 SKILL.md 或 ZIP', 'Choose SKILL.md or ZIP')}<input hidden type="file" accept=".md,.zip" onChange={event => { const name = event.target.files?.[0]?.name; if (name) setSkillNames(current => current.includes(name) ? current : [...current, name]); }}/></label></div><div className="pv-skill-list">{skillNames.length ? skillNames.map(name => <label key={name}><BookOpen size={18}/><span>{name}</span><input type="checkbox" checked={enabledSkills.includes(name)} onChange={event => setEnabledSkills(current => event.target.checked ? [...current, name] : current.filter(item => item !== name))}/>{tr(locale, '启用', 'Enable')}</label>) : <p className="pv-muted">{tr(locale, '尚未选择示例 Skill。', 'No sample Skill selected.')}</p>}</div><label className="pv-field"><span>{tr(locale, 'GitHub 地址', 'GitHub URL')}</span><input className="pv-input" placeholder="https://github.com/…" type="url"/></label><p className="pv-muted">{tr(locale, '此处仅预览交互，不会安装或执行 Skill。', 'Interaction preview only. No Skill will be installed or executed.')}</p></>;
  else if (overlay === 'project') overlayBody = <div className="pv-dialog-fields">{field('name', tr(locale, '项目名称', 'Project name'))}{field('owner', tr(locale, '项目责任人', 'Project owner'))}{field('customer', tr(locale, '客户代称', 'Customer alias'))}<label className="pv-field"><span>{tr(locale, '项目路径', 'Project folder')}</span><input className="pv-input" readOnly value={tr(locale, '示例项目 / 园区协同平台', 'Sample project / Campus platform')}/></label></div>;
  else if (overlay === 'cleanup') overlayBody = <><p>{tr(locale, '选择清理范围', 'Choose what to clear')}</p><label className="pv-check-row"><input type="checkbox" defaultChecked/>{tr(locale, '缓存与临时文件', 'Cache and temporary files')}<span>0 KB</span></label><label className="pv-check-row"><input type="checkbox"/>{tr(locale, '已生成文件', 'Generated files')}<span>0</span></label><p className="pv-muted">{tr(locale, '预览不会清理磁盘文件。', 'The preview will not delete files from disk.')}</p></>;
  else if (overlay === 'communication') overlayBody = <div className="pv-dialog-fields"><label className="pv-field"><span>{tr(locale, '沟通节点', 'Meeting')}</span><input className="pv-input" defaultValue={tr(locale, '方案范围确认', 'Scope review')}/></label><label className="pv-field"><span>{tr(locale, '客户信息及需求', 'Customer needs')}</span><textarea className="pv-textarea" rows={4} defaultValue={project.objective}/></label><label className="pv-field"><span>{tr(locale, '执行清单与生成要求', 'Actions and generation request')}</span><textarea className="pv-textarea" rows={3} defaultValue={project.constraints}/></label></div>;
  else if (overlay === 'new') overlayBody = <p>{tr(locale, '重置当前示例内容，开始一个新的预览项目？', 'Reset the sample content and start a new preview project?')}</p>;

  return <div className={`preview-app style-${style}`} data-ready="true" data-history-version={historyVersion}>
    {(['n','ne','e','se','s','sw','w','nw'] as const).map(edge => <div key={edge} className={`pv-resize pv-resize-${edge}`} hidden={!isDesktop || maximized} onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); window.bidDesktop?.windowResize?.({phase:'start',edge,screenX:event.screenX,screenY:event.screenY}); }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) window.bidDesktop?.windowResize?.({phase:'move',edge,screenX:event.screenX,screenY:event.screenY}); }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { window.bidDesktop?.windowResize?.({phase:'end',edge,screenX:event.screenX,screenY:event.screenY}); event.currentTarget.releasePointerCapture(event.pointerId); } }}/>) }
    <header className="pv-titlebar"><div className="pv-brand"><span><Files size={19}/></span><strong>{tr(locale, '售前解决方案工具', 'Presales Solution Tool')}</strong></div><div className="pv-history"><button className="pv-icon-button" aria-label={tr(locale,'撤销','Undo')} title={tr(locale,'撤销','Undo')} disabled={!history.current.length} onClick={undo}><Undo2 size={17}/></button><button className="pv-icon-button" aria-label={tr(locale,'恢复','Redo')} title={tr(locale,'恢复','Redo')} disabled={!future.current.length} onClick={redo}><Redo2 size={17}/></button></div><div className="pv-window-controls"><button className="pv-icon-button pv-locale" onClick={changeLocale} aria-label={tr(locale,'切换到英文','Switch to Chinese')} title={tr(locale,'切换到英文','Switch to Chinese')}><Languages size={17}/><span>{locale === 'zh' ? 'EN' : '中'}</span></button><button className="pv-icon-button" onClick={() => { const next = theme === 'light' ? 'dark' : 'light'; setTheme(next); window.bidDesktop?.setTheme?.(next); }} aria-label={tr(locale,'切换深浅色','Toggle theme')} title={tr(locale,'切换深浅色','Toggle theme')}>{theme === 'light' ? <Moon size={17}/> : <Sun size={17}/>}</button><button className="pv-icon-button" disabled={!isDesktop} onClick={() => window.bidDesktop?.windowControl?.('minimize')} aria-label={tr(locale,'最小化','Minimize')} title={tr(locale,'最小化（桌面窗口）','Minimize (desktop window)')}><Minus size={17}/></button><button className="pv-icon-button" disabled={!isDesktop} onClick={() => window.bidDesktop?.windowControl?.('maximize')} aria-label={tr(locale,maximized?'还原窗口':'最大化',maximized?'Restore':'Maximize')} title={tr(locale,maximized?'还原窗口':'最大化',maximized?'Restore':'Maximize')}><Maximize2 size={16}/></button><button className="pv-icon-button pv-close" disabled={!isDesktop} onClick={() => window.bidDesktop?.windowControl?.('close')} aria-label={tr(locale,'关闭','Close')} title={tr(locale,'关闭（桌面窗口）','Close (desktop window)')}><X size={18}/></button></div></header>
    <div className="pv-modelbar"><div className="pv-model-modes" role="group" aria-label={tr(locale,'模型通道','Model mode')}>{[{id:'local',icon:Cpu,zh:'本地模型',en:'Local model'},{id:'plans',icon:TerminalSquare,zh:'模型套餐',en:'Model plans'},{id:'api',icon:Cloud,zh:'API',en:'API'},{id:'hybrid',icon:Layers3,zh:'混合',en:'Hybrid'}].map(item => <button key={item.id} className={provider===item.id?'selected':''} aria-pressed={provider===item.id} onClick={() => {setProvider(item.id);if(item.id!==provider)setOverlay('models');}}><item.icon size={15}/><span>{tr(locale,item.zh,item.en)}</span></button>)}</div><button className="pv-current-model" onClick={() => action('models')} title={tr(locale,'展开模型设置','Open model settings')}><i/><span>{model}</span><ChevronDown size={16}/></button><span className="pv-toolbar-divider"/><button className="pv-button pv-skills" onClick={() => action('skills')}><BookOpen size={16}/><span>{tr(locale,'导入 Skills','Import Skills')}</span></button></div>
    <div className="pv-page-host"><Page {...shared}/></div>
    <footer className="pv-comparisonbar"><span className="pv-comparison-label">{tr(locale,'界面方案','Design options')}</span><nav aria-label={tr(locale,'切换界面方案','Switch design option')}>{keys.map(key => <button key={key} onClick={() => chooseStyle(key)} aria-current={style===key?'page':undefined} data-style-choice={key}>{styleNames[key]}</button>)}</nav><span className="pv-preview-note">{tr(locale,'示例资料','Sample data')}</span><button className="pv-icon-button" title={tr(locale,'四版共用示例资料，仅用于比较界面，不执行模型调用或磁盘清理。','All four designs share sample data. No model calls or disk cleanup will run.')} aria-label={tr(locale,'预览说明','About this preview')} onClick={() => setNotice(tr(locale,'四版共用示例资料，不执行模型调用或磁盘清理。','All designs use sample data. Model calls and disk cleanup are not executed.'))}><Info size={16}/></button></footer>
    <input hidden ref={upload} type="file" multiple accept=".pdf,.docx,.xlsx,.pptx,.md,.txt,.csv" onChange={event => { const selected = Array.from(event.target.files || []); setFiles(current => [...current,...selected.map((file,index) => ({id:`upload-${Date.now()}-${index}`,name:file.name,type:file.name.split('.').pop()?.toUpperCase()||'FILE',size:`${Math.max(1,Math.round(file.size/1024))} KB`,updated:'11-11',status:'review' as const}))]); setNotice(tr(locale,'已添加到本次预览，未解析文件内容。','Added to this preview. File contents were not parsed.')); event.currentTarget.value=''; }}/>
    {notice && <div className="pv-notice" role="status">{notice}</div>}
    <dialog ref={dialog} className="pv-dialog" aria-labelledby="pv-dialog-title" onCancel={closeOverlay} onClick={event => {if(event.target===dialog.current)closeOverlay();}}><div className="pv-dialog-heading"><h2 id="pv-dialog-title">{openedFile?.name || (overlay ? overlayTitles[overlay] : '')}</h2><button className="pv-icon-button" onClick={closeOverlay} aria-label={tr(locale,'关闭弹窗','Close dialog')}><X size={20}/></button></div><div className="pv-dialog-content">{overlayBody}</div><footer><button className="pv-button" onClick={copyText}><Copy size={15}/>{copied?tr(locale,'已复制','Copied'):tr(locale,'复制文字','Copy text')}</button><button className="pv-button pv-primary" onClick={() => {if(overlay==='new'){setProject({...demoProject(locale),name:tr(locale,'新建解决方案项目','New solution project'),objective:'',constraints:''});setFiles([]);history.current=[];future.current=[];setHistoryVersion(v=>v+1);}if(overlay==='communication')setNotice(tr(locale,'已保存本次预览中的沟通记录。','Meeting notes saved for this preview.'));closeOverlay();}}>{overlay==='new'?tr(locale,'新建','Create'):tr(locale,'完成','Done')}<Check size={16}/></button></footer></dialog>
  </div>;
}

function historyReplace(url: URL) { window.history.replaceState({}, '', url); }
