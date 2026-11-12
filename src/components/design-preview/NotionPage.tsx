import { Archive, ArrowDownToLine, ArrowUpRight, BookOpen, BriefcaseBusiness, CalendarDays, Check, ChevronDown, ChevronRight, ClipboardList, FileCheck2, FileText, Folder, FolderCog, Layers3, MessageSquare, Plus, Search, Sparkles, Trash2, Upload, Users } from 'lucide-react';
import { stages, tr, type DemoProject, type PreviewPageProps } from './preview-data';
import './notion-page.css';

const stageIcons = [BriefcaseBusiness, ClipboardList, Layers3, FileCheck2, ArrowDownToLine];

export default function NotionPage(props: PreviewPageProps) {
  const { locale, project, stage, files, tasks, onStageChange, onProjectChange, onAction, onOpenFile, onTaskToggle } = props;
  const text = (zh: string, en: string) => tr(locale, zh, en);
  const currentStage = stages.find(item => item.id === stage) || stages[0];
  const properties: { key: keyof DemoProject; zh: string; en: string; icon: typeof Users; type?: string }[] = [
    { key: 'customer', zh: '客户代称', en: 'Customer', icon: Users },
    { key: 'industry', zh: '行业', en: 'Industry', icon: BriefcaseBusiness },
    { key: 'owner', zh: '项目责任人', en: 'Project owner', icon: Users },
    { key: 'budget', zh: '预算信息', en: 'Budget', icon: Archive },
    { key: 'deadline', zh: '计划截止日期', en: 'Target date', icon: CalendarDays, type: 'date' },
  ];

  return <div className="nt-shell">
    <aside className="nt-sidebar" aria-label={text('项目导航', 'Project navigation')}>
      <div className="nt-workspace-name"><span className="nt-workspace-icon"><BookOpen size={19}/></span><strong>{text('方案空间', 'Solutions workspace')}</strong><ChevronDown size={15}/></div>
      <button className="nt-search" type="button" onClick={() => onAction('project')}><Search size={17}/><span>{text('查找项目与资料', 'Find projects and files')}</span></button>
      <div className="nt-sidebar-section"><span>{text('当前项目', 'Current project')}</span><button className="pv-icon-button" type="button" title={text('新建项目', 'New project')} aria-label={text('新建项目', 'New project')} onClick={() => onAction('new')}><Plus size={16}/></button></div>
      <button className="nt-project-switch" type="button" onClick={() => onAction('project')} title={project.name}><Folder size={18}/><strong>{project.name}</strong><ChevronDown size={14}/></button>
      <nav className="nt-stage-nav" aria-label={text('解决方案流程', 'Solution workflow')}>
        {stages.map((item, index) => { const Icon = stageIcons[index]; return <button key={item.id} type="button" className={stage === item.id ? 'active' : ''} aria-current={stage === item.id ? 'page' : undefined} onClick={() => onStageChange(item.id)}><Icon size={17}/><span>{locale === 'zh' ? item.zh : item.en}</span></button>; })}
      </nav>
      <div className="nt-sidebar-bottom">
        <button type="button" title={text('项目设置', 'Project settings')} onClick={() => onAction('project')}><FolderCog size={17}/><span>{text('项目设置', 'Project settings')}</span></button>
        <button type="button" title={text('文件清理', 'File cleanup')} onClick={() => onAction('cleanup')}><Trash2 size={17}/><span>{text('文件清理', 'File cleanup')}</span></button>
      </div>
    </aside>

    <main className="nt-main">
      <div className="nt-page-toolbar">
        <div className="nt-breadcrumb"><Folder size={15}/><span>{project.customer}</span><ChevronRight size={14}/><strong>{locale === 'zh' ? currentStage.zh : currentStage.en}</strong></div>
        <div className="nt-toolbar-actions"><button className="pv-button" type="button" onClick={() => onAction('import')}><Upload size={16}/><span>{text('导入资料', 'Import files')}</span></button><button className="pv-primary" type="button" onClick={() => onAction('generate')}><Sparkles size={16}/><span>{text('生成方案', 'Generate proposal')}</span></button></div>
      </div>

      <div className="nt-document-layout">
        <article className="nt-document">
          <header className="nt-document-header">
            <Folder className="nt-document-icon" size={38} strokeWidth={1.45}/>
            <h1><input aria-label={text('项目名称', 'Project name')} value={project.name} onChange={event => onProjectChange('name', event.target.value)}/></h1>
            <div className="nt-document-meta"><span className="pv-tag">{text('示例项目', 'Example project')}</span><span>{text('售前资料与方案', 'Presales notes and proposal')}</span></div>
          </header>

          <div className="nt-properties" aria-label={text('项目属性', 'Project properties')}>
            {properties.map(({ key, zh, en, icon: Icon, type }) => <label key={key} className="nt-property"><span><Icon size={15}/>{text(zh, en)}</span><input type={type || 'text'} value={project[key]} onChange={event => onProjectChange(key, event.target.value)}/></label>)}
          </div>

          <section className="nt-document-section" id="nt-objective">
            <h2 id="nt-objective-title">{text('业务目标', 'Business objective')}</h2>
            <textarea aria-labelledby="nt-objective-title" value={project.objective} onChange={event => onProjectChange('objective', event.target.value)} rows={3}/>
          </section>

          <section className="nt-document-section" id="nt-boundary">
            <h2 id="nt-boundary-title">{text('约束与不可承诺项', 'Constraints and exclusions')}</h2>
            <textarea aria-labelledby="nt-boundary-title" value={project.constraints} onChange={event => onProjectChange('constraints', event.target.value)} rows={3}/>
          </section>

          <section className="nt-document-section nt-document-files" id="nt-files">
            <div className="nt-section-heading"><h2>{text('项目资料', 'Project files')}</h2><button type="button" onClick={() => onAction('import')}><Plus size={16}/>{text('添加', 'Add')}</button></div>
            <div className="nt-file-list">
              {files.map(file => <button key={file.id} className="nt-file-link" type="button" onClick={() => onOpenFile(file)}><FileText size={19}/><span className="nt-file-name">{file.name}</span><span className="nt-file-meta">{file.type} · {file.size}</span><ArrowUpRight size={15}/></button>)}
              {!files.length && <button className="nt-empty-file" type="button" onClick={() => onAction('import')}><Plus size={17}/>{text('添加第一份项目资料', 'Add the first project file')}</button>}
            </div>
          </section>

          <section className="nt-document-section" id="nt-actions">
            <h2>{text('下一步', 'Next steps')}</h2>
            <div className="nt-checklist">{tasks.map(task => <label key={task.id} className={task.done ? 'done' : ''}><input type="checkbox" checked={task.done} onChange={() => onTaskToggle(task.id)}/><span className="nt-checkmark" aria-hidden="true">{task.done && <Check size={12}/>}</span><span>{task.title}</span></label>)}</div>
          </section>

          <section className="nt-document-section nt-communication" id="nt-communication">
            <div className="nt-section-heading"><h2>{text('客户沟通', 'Customer conversations')}</h2><button type="button" onClick={() => onAction('communication')}><Plus size={16}/>{text('新增记录', 'Add note')}</button></div>
            <button className="nt-conversation-link" type="button" onClick={() => onAction('communication')}><MessageSquare size={18}/><span><strong>{text('首次需求沟通', 'Discovery conversation')}</strong><small>{text('需求、范围与待确认事项', 'Requirements, scope, and open questions')}</small></span><ChevronRight size={16}/></button>
          </section>
          <footer className="nt-document-footer"><span>{text('所有内容为界面预览示例', 'All content is for this interface preview')}</span><button type="button" onClick={() => onAction('export')}><ArrowDownToLine size={15}/>{text('输出文件', 'Export files')}</button></footer>
        </article>

        <aside className="nt-document-outline" aria-label={text('页面目录', 'On this page')}>
          <span>{text('本页内容', 'On this page')}</span>
          <a href="#nt-objective">{text('业务目标', 'Business objective')}</a>
          <a href="#nt-boundary">{text('项目边界', 'Project scope')}</a>
          <a href="#nt-files">{text('项目资料', 'Project files')}</a>
          <a href="#nt-actions">{text('下一步', 'Next steps')}</a>
          <a href="#nt-communication">{text('客户沟通', 'Conversations')}</a>
        </aside>
      </div>
    </main>
  </div>;
}
