import { useState } from 'react';
import { ArrowRight, BriefcaseBusiness, ChevronDown, Circle, ClipboardCheck, FileCheck2, FileOutput, FileText, FolderClosed, FolderCog, LayoutGrid, MessageSquare, MoreHorizontal, Plus, Search, Settings2, Sparkles, Trash2, Upload } from 'lucide-react';
import { stages, tr, type DemoProject, type PreviewPageProps } from './preview-data';
import './shadcn-page.css';

type WorkspaceTab = 'overview' | 'materials' | 'communications' | 'results';
const stageIcons = { presales: BriefcaseBusiness, requirements: FileCheck2, bid: FolderClosed, handover: ClipboardCheck, outputs: FileOutput };

export default function ShadcnPage(props: PreviewPageProps) {
  const { locale, project, stage, files, tasks, onStageChange, onProjectChange, onAction, onOpenFile, onTaskToggle } = props;
  const [tab, setTab] = useState<WorkspaceTab>('overview');
  const [query, setQuery] = useState('');
  const text = (zh: string, en: string) => tr(locale, zh, en);
  const currentStage = stages.find(item => item.id === stage)!;
  const pending = tasks.filter(task => !task.done).length;
  const ready = files.filter(file => file.status === 'ready').length;
  const filteredFiles = files.filter(file => file.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const tabs: { id: WorkspaceTab; label: string; count?: number }[] = [
    { id: 'overview', label: text('项目概览', 'Overview') },
    { id: 'materials', label: text('资料清单', 'Materials'), count: files.length },
    { id: 'communications', label: text('沟通记录', 'Communications') },
    { id: 'results', label: text('生成文件', 'Generated files'), count: 0 },
  ];
  const propertyFields: { key: keyof DemoProject; label: string; type?: string }[] = [
    { key: 'name', label: text('项目名称', 'Project name') },
    { key: 'customer', label: text('客户代称', 'Customer alias') },
    { key: 'industry', label: text('行业', 'Industry') },
    { key: 'owner', label: text('项目责任人', 'Project owner') },
    { key: 'budget', label: text('预算信息', 'Budget information') },
    { key: 'deadline', label: text('计划截止日期', 'Target deadline'), type: 'date' },
  ];

  const renderFileTable = (compact = false) => <section className={`sdc-files${compact ? ' sdc-files-compact' : ''}`} aria-label={text('项目资料', 'Project materials')}>
    <div className="sdc-section-toolbar">
      <div><h2>{text('项目资料', 'Project materials')}</h2><span className="sdc-count">{files.length}</span></div>
      <div className="sdc-file-controls"><label className="sdc-search"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} aria-label={text('搜索资料', 'Search materials')} placeholder={text('搜索资料…', 'Search materials…')}/></label><button className="pv-icon-button" type="button" title={text('导入资料', 'Import materials')} aria-label={text('导入资料', 'Import materials')} onClick={() => onAction('import')}><Plus size={17}/></button></div>
    </div>
    <div className="sdc-table-scroll"><table className="sdc-file-table"><thead><tr><th>{text('文件名称', 'File name')}</th><th>{text('状态', 'Status')}</th><th>{text('大小', 'Size')}</th><th>{text('最近更新', 'Updated')}</th><th><span className="sdc-visually-hidden">{text('操作', 'Actions')}</span></th></tr></thead><tbody>
      {filteredFiles.map(file => <tr key={file.id}><td><button type="button" className="sdc-file-link" onClick={() => onOpenFile(file)}><span className={`sdc-file-icon sdc-file-${file.type.toLowerCase()}`}><FileText size={18}/></span><span>{file.name}<small>{file.type}</small></span></button></td><td><span className={`sdc-status ${file.status}`}><span/>{file.status === 'ready' ? text('已整理', 'Ready') : text('待确认', 'Needs review')}</span></td><td>{file.size}</td><td>{file.updated}</td><td><button type="button" className="pv-icon-button" title={text('查看文件', 'View file')} aria-label={`${text('查看文件', 'View file')}: ${file.name}`} onClick={() => onOpenFile(file)}><ArrowRight size={16}/></button></td></tr>)}
      {!filteredFiles.length && <tr><td colSpan={5} className="sdc-no-results">{text('没有找到匹配的资料。', 'No matching materials.')}</td></tr>}
    </tbody></table></div>
    {!compact && <footer className="sdc-table-footer"><span>{text(`共 ${filteredFiles.length} 个文件`, `${filteredFiles.length} files`)}</span><button className="pv-button" type="button" onClick={() => onAction('import')}><Upload size={16}/>{text('导入资料', 'Import materials')}</button></footer>}
  </section>;

  return <div className="sdc-root">
    <aside className="sdc-sidebar" aria-label={text('工作空间导航', 'Workspace navigation')}>
      <div className="sdc-workspace"><span className="sdc-workspace-icon"><LayoutGrid size={19}/></span><div><strong>{text('解决方案工作空间', 'Solutions workspace')}</strong><span>{text('示例项目', 'Demo project')}</span></div><ChevronDown size={15}/></div>
      <button className="sdc-project-switch" type="button" onClick={() => onAction('project')}><FolderClosed size={17}/><span>{project.name}</span><ChevronDown size={14}/></button>
      <div className="sdc-nav-caption">{text('项目工作流', 'Project workflow')}</div>
      <nav className="sdc-stage-nav" aria-label={text('解决方案流程', 'Solution lifecycle')}>{stages.map(item => { const Icon = stageIcons[item.id]; return <button key={item.id} type="button" className={stage === item.id ? 'selected' : ''} aria-current={stage === item.id ? 'page' : undefined} onClick={() => { onStageChange(item.id); setTab(item.id === 'outputs' ? 'results' : 'overview'); }}><Icon size={18}/><span>{locale === 'zh' ? item.zh : item.en}</span>{stage === item.id && <span className="sdc-nav-indicator"/>}</button>; })}</nav>
      <div className="sdc-sidebar-bottom"><button type="button" onClick={() => onAction('new')}><Plus size={17}/>{text('新建项目', 'New project')}</button><button type="button" onClick={() => onAction('project')}><FolderCog size={17}/>{text('项目设置', 'Project settings')}</button><button type="button" onClick={() => onAction('cleanup')}><Trash2 size={17}/>{text('文件清理', 'File cleanup')}</button><div className="sdc-profile"><span>ST</span><div><strong>{project.owner}</strong><small>{text('本地工作空间', 'Local workspace')}</small></div></div></div>
    </aside>

    <main className="sdc-main">
      <header className="sdc-page-header"><div><div className="sdc-location"><FolderClosed size={15}/><span>{project.customer}</span><span>/</span><span>{locale === 'zh' ? currentStage.zh : currentStage.en}</span></div><h1>{project.name}</h1></div><div className="sdc-page-actions"><button className="pv-button" type="button" onClick={() => onAction('import')}><Upload size={17}/>{text('导入资料', 'Import materials')}</button><button className="pv-button pv-primary" type="button" onClick={() => onAction('generate')}><Sparkles size={17}/>{text('生成方案', 'Generate proposal')}</button><details className="sdc-project-menu"><summary className="pv-icon-button" aria-label={text('更多项目操作', 'More project actions')} title={text('更多项目操作', 'More project actions')}><MoreHorizontal size={18}/></summary><div onClick={event => event.currentTarget.closest('details')?.removeAttribute('open')}><button type="button" onClick={() => onAction('new')}><Plus size={16}/>{text('新建项目', 'New project')}</button><button type="button" onClick={() => onAction('project')}><FolderCog size={16}/>{text('项目设置', 'Project settings')}</button><button type="button" onClick={() => onAction('cleanup')}><Trash2 size={16}/>{text('文件清理', 'File cleanup')}</button></div></details></div></header>

      <div className="sdc-progress-strip" aria-label={text('项目状态', 'Project status')}><span className="sdc-project-status"><Circle size={13}/>{locale === 'zh' ? currentStage.zh : currentStage.en}</span><span>{text('资料', 'Materials')} <strong>{files.length}</strong></span><span>{text('已整理', 'Ready')} <strong>{ready}</strong></span><span>{text('待办事项', 'Open tasks')} <strong>{pending}</strong></span><span className="sdc-deadline">{text('截止', 'Due')} <strong>{project.deadline}</strong></span></div>

      <nav className="sdc-tabs" role="tablist" aria-label={text('项目视图', 'Project views')}>{tabs.map(item => <button key={item.id} role="tab" type="button" id={`sdc-tab-${item.id}`} aria-controls={`sdc-panel-${item.id}`} aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}{item.count !== undefined && <span>{item.count}</span>}</button>)}</nav>

      <section className="sdc-content" id={`sdc-panel-${tab}`} role="tabpanel" aria-labelledby={`sdc-tab-${tab}`}>
        {tab === 'overview' && <>
          <div className="sdc-overview-grid">
            <section className="sdc-project-details"><div className="sdc-section-heading"><h2>{text('项目与边界', 'Project and scope')}</h2><button type="button" className="pv-icon-button" title={text('项目设置', 'Project settings')} aria-label={text('项目设置', 'Project settings')} onClick={() => onAction('project')}><Settings2 size={17}/></button></div><div className="sdc-property-grid">{propertyFields.map(field => <label key={field.key} className="sdc-field"><span>{field.label}</span><input className="pv-input" type={field.type || 'text'} aria-label={field.label} value={project[field.key]} onChange={event => onProjectChange(field.key, event.target.value)}/></label>)}</div><label className="sdc-field sdc-prose"><span>{text('业务目标', 'Business objective')}</span><textarea className="pv-textarea" rows={2} value={project.objective} onChange={event => onProjectChange('objective', event.target.value)}/></label><label className="sdc-field sdc-prose"><span>{text('约束与不可承诺项', 'Constraints and non-commitments')}</span><textarea className="pv-textarea" rows={2} value={project.constraints} onChange={event => onProjectChange('constraints', event.target.value)}/></label></section>
            <aside className="sdc-task-panel"><div className="sdc-section-heading"><h2>{text('待办事项', 'Next actions')}</h2><span className="sdc-count">{pending}</span></div><div className="sdc-task-list">{tasks.map(task => <label key={task.id} className={task.done ? 'completed' : ''}><input type="checkbox" checked={task.done} onChange={() => onTaskToggle(task.id)}/><span>{task.title}</span></label>)}</div><button type="button" className="sdc-add-communication" onClick={() => onAction('communication')}><Plus size={16}/>{text('新增沟通记录', 'Add communication')}</button><div className="sdc-activity"><h3>{text('最近动态', 'Recent activity')}</h3><div><span className="sdc-activity-dot"/><p><strong>{text('接口范围清单已更新', 'Integration scope updated')}</strong><span>{text('11 月 11 日 · 09:20', 'Nov 11 · 09:20')}</span></p></div><div><span className="sdc-activity-dot"/><p><strong>{text('已整理首次沟通纪要', 'Discovery notes organized')}</strong><span>{text('11 月 10 日 · 16:45', 'Nov 10 · 16:45')}</span></p></div></div></aside>
          </div>
          {renderFileTable(true)}
        </>}
        {tab === 'materials' && renderFileTable()}
        {tab === 'communications' && <section className="sdc-communication-page"><div className="sdc-section-toolbar"><div><h2>{text('客户沟通与文件响应', 'Customer communications')}</h2></div><button className="pv-button" type="button" onClick={() => onAction('communication')}><Plus size={16}/>{text('新增沟通记录', 'Add communication')}</button></div><article><span className="sdc-communication-icon"><MessageSquare size={20}/></span><div><h3>{text('首次需求沟通', 'Discovery meeting')}</h3><span className="sdc-communication-meta">{text('11 月 10 日 · 方案团队', 'Nov 10 · Solutions team')}</span><p>{project.objective}</p><div className="sdc-linked-file"><FileText size={16}/><button type="button" onClick={() => { const note=files.find(file=>file.id==='notes'); if(note)onOpenFile(note); }}>{text('首次沟通纪要.docx', 'Discovery meeting notes.docx')}</button></div></div></article></section>}
        {tab === 'results' && <section className="sdc-results-page"><FileOutput size={32}/><h2>{text('还没有生成文件', 'No generated files yet')}</h2><p>{text('整理项目资料后，开始生成首版方案。', 'Organize the project materials, then prepare the first proposal.')}</p><button type="button" className="pv-button pv-primary" onClick={() => onAction('generate')}><Sparkles size={17}/>{text('生成方案', 'Generate proposal')}</button></section>}
      </section>
    </main>
  </div>;
}
