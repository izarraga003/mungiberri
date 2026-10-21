# Mungiberri Txoko

Web/app de reservas del txoko. Frontend estático (`index.html`, `app.js`, `styles.css`, `sw.js`) en Netlify; base de datos en Supabase. Tablas que usa `app.js`: `profiles`, `reservations`, `blocked_days`.

## Supabase: tablas nuevas

Desde el 30/10/2026, Supabase ya no da acceso automático por la Data API a las tablas nuevas del esquema `public`.

Cada vez que propongas crear una tabla en Supabase, da el SQL completo para ejecutar en el SQL Editor, incluyendo:

- `alter table public.<tabla> enable row level security;`
- sus políticas RLS;
- `grant select, insert, update, delete on public.<tabla> to authenticated;`
- `grant select, insert, update, delete on public.<tabla> to service_role;`
- `grant select on public.<tabla> to anon;` solo si la tabla debe ser legible sin login (en esta app todo va tras el login).
