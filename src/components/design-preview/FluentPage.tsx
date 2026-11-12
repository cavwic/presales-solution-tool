import { useState } from 'react';
import {
  ArrowRight, BriefcaseBusiness, Check, ChevronDown, ChevronRight, ClipboardCheck,
  FileInput, FileOutput, FileSpreadsheet, FileText, FolderClosed, FolderCog,
  MessageSquare, Plus, Settings2, Sparkles, Trash2, Upload,
} from 'lucide-react';
import { stages, tr, type DemoProject, type PreviewPageProps } from './preview-data';
import './fluent-page.css';

const stageIcons = [BriefcaseBusiness, FileInput, FolderClosed, ClipboardCheck, FileOutput];

export default function FluentPage(props: PreviewPageProps) {
  const { locale, project, stage, files, tasks, onStageChange, onProjectChange, onAction, onOpenFile, onTaskToggle } = props;
  const [tab, setTab] = useState<'details' | 'communications'>('details');
  const currentStage = stages.find(item => item.id === stage) || stages[0];
  const completed = tasks.filter(item => item.done).length;
  const meetingFile = files.find(item => item.id === 'notes');
  const field = (key: keyof DemoProject, zh: string, en: string, type = 'text', wide = false) => (
    <label className={`f2-field${wide ? ' f2-field-wide' : ''}`} key={key}>
      <span>{tr(locale, zh, en)}</span>
      <input className="pv-input" type={type} aria-label={tr(locale, zh, en)} value={project[key]} onChange={event => onProjectChange(key, event.target.value)} />
    </label>
  );

  return <div className="f2-page style-fluent">
    <aside className="f2-navigation" aria-label={tr(locale, '解决方案流程', 'Solution workflow')}>
      <button className="f2-project-picker" type="button" onClick={() => onAction('project')} title={tr(locale, '项目设置', 'Project settings')}>
        <span className="f2-project-icon"><FolderClosed size={21} /></span>
        <span><strong>{project.customer}</strong><small>{tr(locale, '当前项目', 'Current project')}</small></span>
        <ChevronDown size={16} />
      </button>
      <nav className="f2-stage-list">
        {stages.map((item, index) => {
          const Icon = stageIcons[index];
          return <button key={item.id} className={stage === item.id ? 'active' : ''} type="button" aria-current={stage === item.id ? 'page' : undefined} onClick={() => onStageChange(item.id)}>
            <Icon size={19} /><span>{tr(locale, item.zh, item.en)}</span>
            {stage === item.id && <ChevronRight size={15} />}
          </button>;
        })}
      </nav>
      <div className="f2-navigation-bottom">
        <button type="button" onClick={() => onAction('new')}><Plus size={18} /><span>{tr(locale, '新建项目', 'New project')}</span></button>
        <button type="button" onClick={() => onAction('project')}><FolderCog size={18} /><span>{tr(locale, '项目设置', 'Project settings')}</span></button>
        <button type="button" onClick={() => onAction('cleanup')}><Trash2 size={18} /><span>{tr(locale, '文件清理', 'File cleanup')}</span></button>
      </div>
    </aside>

    <main className="f2-main">
      <div className="f2-breadcrumb"><span>{project.customer}</span><ChevronRight size={14} /><span>{project.name}</span></div>
      <header className="f2-page-heading">
        <div><h1>{tr(locale, currentStage.zh, currentStage.en)}</h1><span className="pv-tag">{tr(locale, '示例项目', 'Demo project')}</span></div>
        <button className="pv-button pv-primary" type="button" onClick={() => onAction('generate')}><Sparkles size={17} />{tr(locale, '生成方案', 'Generate proposal')}</button>
      </header>

      <div className="f2-command-bar" aria-label={tr(locale, '项目操作', 'Project actions')}>
        <div className="f2-view-tabs" role="tablist" aria-label={tr(locale, '工作区视图', 'Workspace views')}>
          <button type="button" role="tab" aria-selected={tab === 'details'} className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}><Settings2 size={17} />{tr(locale, '项目资料', 'Project details')}</button>
          <button type="button" role="tab" aria-selected={tab === 'communications'} className={tab === 'communications' ? 'active' : ''} onClick={() => setTab('communications')}><MessageSquare size={17} />{tr(locale, '客户沟通', 'Conversations')}</button>
        </div>
        <div className="f2-command-actions"><button type="button" onClick={() => onAction('import')}><Upload size={17} />{tr(locale, '导入资料', 'Import files')}</button><button type="button" onClick={() => onAction('export')}><FileOutput size={17} />{tr(locale, '导出', 'Export')}</button></div>
      </div>

      <div className="f2-workspace-columns">
        <div className="f2-primary-pane" role="tabpanel">
          {tab === 'details' ? <>
            <section className="f2-property-group" aria-labelledby="f2-project-title">
              <header><h2 id="f2-project-title">{tr(locale, '项目与客户', 'Project and customer')}</h2><span>{tr(locale, '项目资料', 'Project details')}</span></header>
              <div className="f2-property-grid">
                {field('name', '项目名称', 'Project name')}
                {field('customer', '客户代称', 'Customer alias')}
                {field('industry', '行业', 'Industry')}
                {field('owner', '项目责任人', 'Project owner')}
                {field('budget', '预算信息', 'Budget information')}
                {field('deadline', '计划截止日期', 'Target deadline', 'date')}
              </div>
            </section>
            <section className="f2-property-group f2-scope-group" aria-labelledby="f2-scope-title">
              <header><h2 id="f2-scope-title">{tr(locale, '目标与实施边界', 'Goals and delivery scope')}</h2></header>
              <div className="f2-scope-fields">
                <label className="f2-field"><span>{tr(locale, '业务目标', 'Business objective')}</span><textarea className="pv-textarea" aria-label={tr(locale, '业务目标', 'Business objective')} rows={3} value={project.objective} onChange={event => onProjectChange('objective', event.target.value)} /></label>
                <label className="f2-field"><span>{tr(locale, '约束与不可承诺项', 'Constraints and non-commitments')}</span><textarea className="pv-textarea" aria-label={tr(locale, '约束与不可承诺项', 'Constraints and non-commitments')} rows={3} value={project.constraints} onChange={event => onProjectChange('constraints', event.target.value)} /></label>
              </div>
            </section>
          </> : <section className="f2-property-group f2-conversation-panel" aria-labelledby="f2-conversation-title">
            <header><h2 id="f2-conversation-title">{tr(locale, '客户沟通记录', 'Customer conversations')}</h2><button className="pv-icon-button" type="button" onClick={() => onAction('communication')} aria-label={tr(locale, '新增沟通记录', 'Add conversation')} title={tr(locale, '新增沟通记录', 'Add conversation')}><Plus size={18} /></button></header>
            <article><span className="f2-conversation-mark"><MessageSquare size={18} /></span><div><time>{tr(locale, '11 月 10 日 · 16:45', 'Nov 10 · 16:45')}</time><h3>{tr(locale, '首次需求沟通', 'Discovery meeting')}</h3><p>{project.objective}</p>{meetingFile && <button className="f2-text-action" type="button" onClick={() => onOpenFile(meetingFile)}>{tr(locale, '查看沟通纪要', 'View meeting notes')}<ArrowRight size={15} /></button>}</div></article>
            <article><span className="f2-conversation-mark"><ClipboardCheck size={18} /></span><div><time>{tr(locale, '11 月 11 日 · 09:20', 'Nov 11 · 09:20')}</time><h3>{tr(locale, '确认接口与交付范围', 'Confirm integrations and delivery scope')}</h3><p>{project.constraints}</p></div></article>
            <button className="pv-button" type="button" onClick={() => onAction('communication')}><Plus size={17} />{tr(locale, '新增沟通记录', 'Add conversation')}</button>
          </section>}
        </div>

        <aside className="f2-related-pane" aria-label={tr(locale, '项目相关内容', 'Related project content')}>
          <section className="f2-related-section">
            <header><h2>{tr(locale, '相关资料', 'Related files')}</h2><span className="f2-count">{files.length}</span><button className="pv-icon-button" type="button" onClick={() => onAction('import')} aria-label={tr(locale, '导入资料', 'Import files')} title={tr(locale, '导入资料', 'Import files')}><Plus size={17} /></button></header>
            <div className="f2-file-list">{!files.length && <p className="f2-empty-files">{tr(locale, '尚未导入资料', 'No files imported')}</p>}{files.map(file => <button className="f2-file-row" type="button" key={file.id} onClick={() => onOpenFile(file)} title={file.name}>
              <span className={`f2-file-icon ${file.type.toLowerCase()}`}>{file.type === 'XLSX' ? <FileSpreadsheet size={21} /> : <FileText size={21} />}</span>
              <span><strong>{file.name}</strong><small>{file.size}<span aria-hidden="true"> · </span>{tr(locale, file.status === 'ready' ? '已导入' : '待确认', file.status === 'ready' ? 'Imported' : 'Needs review')}</small></span><ChevronRight size={15} />
            </button>)}</div>
            <button className="f2-text-action" type="button" onClick={() => onAction('import')}><Upload size={16} />{tr(locale, '添加项目资料', 'Add project files')}</button>
          </section>

          <section className="f2-related-section f2-task-section">
            <header><h2>{tr(locale, '准备清单', 'Preparation checklist')}</h2><span className="f2-task-count">{completed} / {tasks.length}</span></header>
            <div className="f2-task-list">{tasks.map(task => <label className={`f2-task-row${task.done ? ' done' : ''}`} key={task.id}><input type="checkbox" checked={task.done} onChange={() => onTaskToggle(task.id)} /><span>{task.title}</span>{task.done && <Check size={14} aria-hidden="true" />}</label>)}</div>
          </section>

        </aside>
      </div>
    </main>
  </div>;
}
