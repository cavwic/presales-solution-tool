import { useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, BookOpen, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, Circle, FileText, FolderClosed, FolderCog, ListTodo, MessageSquare, Plus, Search, Settings2, Sparkles, Trash2, Upload, UserRound } from 'lucide-react';
import { stages, tr, type PreviewPageProps } from './preview-data';
import './linear-page.css';

export default function LinearPage(props: PreviewPageProps) {
  const { locale, project, stage, files, tasks, onStageChange, onProjectChange, onAction, onOpenFile, onTaskToggle } = props;
  const currentStage = stages.find(item => item.id === stage)!;
  const progress = tasks.filter(task => task.done).length;
  const [query, setQuery] = useState('');
  const visibleFiles = files.filter(file => file.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="ln-workspace">
    <aside className="ln-sidebar">
      <button className="ln-workspace-picker" onClick={() => onAction('project')}><span className="ln-workspace-avatar">S</span><span>{tr(locale,'解决方案空间','Solutions workspace')}</span><ChevronDown size={15}/></button>
      <label className="ln-search"><Search size={16}/><input aria-label={tr(locale,'查找项目资料','Find project materials')} placeholder={tr(locale,'查找项目资料','Find materials')} value={query} onChange={event => setQuery(event.target.value)}/></label>
      <div className="ln-navigation-heading"><span>{tr(locale,'当前项目','Current project')}</span><button className="pv-icon-button" title={tr(locale,'新建项目','New project')} onClick={() => onAction('new')}><Plus size={16}/></button></div>
      <div className="ln-project-name"><FolderClosed size={17}/><strong>{project.name}</strong></div>
      <nav className="ln-stage-nav" aria-label={tr(locale,'解决方案流程','Solution lifecycle')}>{stages.map((item,index) => { const Icon=[BookOpen,ListTodo,FileText,CheckCircle2,ArrowDownToLine][index]; return <button key={item.id} className={stage===item.id?'active':''} aria-current={stage===item.id?'page':undefined} onClick={() => onStageChange(item.id)}><Icon size={17}/><span>{tr(locale,item.zh,item.en)}</span>{index===0 && <small>{files.length}</small>}</button>; })}</nav>
      <div className="ln-related"><span>{tr(locale,'项目资料','Project materials')}</span>{visibleFiles.map(file => <button key={file.id} onClick={() => onOpenFile(file)}><FileText size={15}/><span>{file.name}</span></button>)}</div>
      <div className="ln-sidebar-footer"><button onClick={() => onAction('project')}><FolderCog size={17}/>{tr(locale,'项目设置','Project settings')}</button><button onClick={() => onAction('cleanup')}><Trash2 size={17}/>{tr(locale,'文件清理','File cleanup')}</button></div>
    </aside>
    <div className="ln-main-shell">
      <header className="ln-viewbar"><div><span>{tr(locale,'项目','Projects')}</span><ChevronRight size={14}/><span>{project.name}</span><ChevronRight size={14}/><strong>{tr(locale,currentStage.zh,currentStage.en)}</strong></div><button className="pv-icon-button" title={tr(locale,'项目属性','Project properties')} onClick={() => onAction('project')}><Settings2 size={17}/></button></header>
      <div className="ln-view-tabs"><span className="active">{tr(locale,'概览','Overview')}</span><button onClick={() => document.getElementById('ln-files')?.scrollIntoView({behavior:'smooth'})}>{tr(locale,'资料','Materials')} <small>{files.length}</small></button><button onClick={() => onAction('communication')}>{tr(locale,'沟通记录','Meetings')}</button><div/><button className="pv-button" onClick={() => onAction('import')}><Upload size={15}/>{tr(locale,'导入资料','Import')}</button><button className="pv-button pv-primary" onClick={() => onAction('generate')}><Sparkles size={15}/>{tr(locale,'生成方案','Generate')}</button></div>
      <div className="ln-columns">
        <main className="ln-document">
          <div className="ln-document-heading"><span className="ln-project-symbol"><FolderClosed size={25}/></span><span className="pv-tag">{tr(locale,'示例项目','Sample project')}</span></div>
          <input className="ln-title-input" aria-label={tr(locale,'项目名称','Project name')} value={project.name} onChange={event => onProjectChange('name',event.target.value)}/>
          <div className="ln-inline-status"><span><Circle size={12}/>{tr(locale,'售前进行中','Presales in progress')}</span><span><UserRound size={13}/>{project.owner}</span><span><CalendarDays size={13}/>{project.deadline}</span></div>
          <section className="ln-prose"><h2>{tr(locale,'业务目标','Business objective')}</h2><textarea aria-label={tr(locale,'业务目标','Business objective')} value={project.objective} onChange={event => onProjectChange('objective',event.target.value)} rows={3}/></section>
          <section className="ln-prose"><h2>{tr(locale,'约束与不可承诺项','Constraints and non-commitments')}</h2><textarea aria-label={tr(locale,'约束与不可承诺项','Constraints and non-commitments')} value={project.constraints} onChange={event => onProjectChange('constraints',event.target.value)} rows={3}/></section>
          <section className="ln-doc-section" id="ln-files"><header><h2>{tr(locale,'参考资料','Reference materials')}</h2><button className="pv-icon-button" title={tr(locale,'导入资料','Import materials')} onClick={() => onAction('import')}><Plus size={16}/></button></header><div className="ln-files">{visibleFiles.length ? visibleFiles.map(file => <button key={file.id} onClick={() => onOpenFile(file)}><span className="ln-file-icon"><FileText size={18}/></span><span><strong>{file.name}</strong><small>{file.type} · {file.size}</small></span><span className={`ln-file-state ${file.status}`}>{file.status==='ready'?<Check size={13}/>:<Circle size={12}/>} {file.status==='ready'?tr(locale,'已整理','Organized'):tr(locale,'待确认','To review')}</span><ArrowUpRight size={15}/></button>) : <p className="pv-muted">{tr(locale,'导入项目资料后开始整理。','Import project materials to get started.')}</p>}</div></section>
          <section className="ln-doc-section"><header><h2>{tr(locale,'最新沟通','Latest meeting')}</h2><button className="pv-icon-button" onClick={() => onAction('communication')} title={tr(locale,'新增沟通','Add meeting')}><Plus size={16}/></button></header><button className="ln-meeting" onClick={() => onAction('communication')}><MessageSquare size={18}/><span><strong>{tr(locale,'首次需求沟通','Discovery meeting')}</strong><small>{tr(locale,'访客、会议与工单场景梳理','Visitor, meeting and service request workflows')} · 11-10</small></span><ChevronRight size={16}/></button></section>
        </main>
        <aside className="ln-inspector"><h2>{tr(locale,'项目属性','Properties')}</h2>{([
          ['customer',tr(locale,'客户','Customer')],['industry',tr(locale,'行业','Industry')],['owner',tr(locale,'责任人','Owner')],['budget',tr(locale,'预算','Budget')],['deadline',tr(locale,'截止日期','Deadline')],
        ] as const).map(([key,label]) => <label className="ln-property" key={key}><span>{label}</span><input type={key==='deadline'?'date':'text'} aria-label={tr(locale,key==='customer'?'客户代称':key==='owner'?'项目责任人':key==='budget'?'预算信息':key==='deadline'?'计划截止日期':'行业',key==='customer'?'Customer alias':key==='owner'?'Project owner':key==='budget'?'Budget information':key==='deadline'?'Target deadline':'Industry')} value={project[key]} onChange={event => onProjectChange(key,event.target.value)}/></label>)}
          <div className="ln-inspector-tasks"><header><h2>{tr(locale,'执行清单','Action items')}</h2><span>{progress}/{tasks.length}</span></header>{tasks.map(task => <label key={task.id}><input type="checkbox" checked={task.done} onChange={() => onTaskToggle(task.id)}/><span className={task.done?'done':''}>{task.title}</span></label>)}</div>
          <div className="ln-inspector-foot"><span><span className="ln-state-dot"/>{tr(locale,'当前阶段','Current stage')}</span><strong>{tr(locale,currentStage.zh,currentStage.en)}</strong><button onClick={() => onAction('export')}>{tr(locale,'查看输出文件','View output files')}<ArrowUpRight size={14}/></button></div>
        </aside>
      </div>
    </div>
  </div>;
}
