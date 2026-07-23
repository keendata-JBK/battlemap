begin;

alter table public.daily_report_imports
  alter column model set default 'gpt-5.6-sol';

alter table public.marketing_qa_jobs
  alter column model set default 'gpt-5.6-sol';

alter table public.daily_report_analysis_jobs
  alter column model set default 'gpt-5.6-sol';

alter table public.sales_reports
  alter column model set default 'gpt-5.6-sol';

alter table public.dingtalk_write_proposals
  alter column model set default 'gpt-5.6-sol';

commit;
