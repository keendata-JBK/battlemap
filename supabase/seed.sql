-- 本文件不创建真实用户。先在 Supabase Auth 中创建首位管理员，再执行：
-- update public.profiles set role = 'admin', display_name = '管理员' where email = 'admin@example.com';

-- 可选：将用户分配至团队。
-- update public.profiles p
-- set team_id = t.id
-- from public.teams t
-- where p.email = 'sales@example.com' and t.name = '华东一组';
