begin;

alter table public.projects
  add column contract_signed_amount numeric(16,2)
  check (contract_signed_amount is null or contract_signed_amount >= 0);

comment on column public.projects.contract_signed_amount is '科杰实际合同签订金额（万元）；空值表示尚未补录，不等同于零金额';

commit;
