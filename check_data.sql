-- Check current state of users
SELECT 
  au.id, 
  au.email, 
  au.raw_user_meta_data->>'display_name' as display_name,
  au.created_at
FROM auth.users au
ORDER BY au.created_at DESC
LIMIT 20;

-- Check user_profiles
SELECT id, display_name, phone, created_at 
FROM user_profiles
ORDER BY created_at DESC
LIMIT 20;

-- Check registrations
SELECT 
  r.id, 
  r.name, 
  r.phone, 
  r.status, 
  r.created_at,
  s.name as session_name
FROM registrations r
LEFT JOIN sessions s ON s.id = r.session_id
ORDER BY r.created_at DESC
LIMIT 20;
