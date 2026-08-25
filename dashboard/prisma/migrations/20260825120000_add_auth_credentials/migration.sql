-- Agrega credenciales de acceso al dashboard sobre la fila unica de configuracion.
ALTER TABLE "configuracion" ADD COLUMN "auth_username" VARCHAR(50);
ALTER TABLE "configuracion" ADD COLUMN "auth_password_hash" VARCHAR(100);

-- Usuario y password dummy iniciales (username: rene.aps / password: pass1234).
-- Si la fila id=1 ya existe (caso normal en produccion), solo completa las
-- columnas de auth sin tocar el resto de la configuracion. Cambiar el password
-- desde Configuracion > Mi cuenta despues del primer login.
INSERT INTO "configuracion" (id, frecuencia_pago_default, auth_username, auth_password_hash)
VALUES (1, 'QUINCENAL', 'rene.aps', '$2b$10$6nBPReXHSbrLhQUdnWni6OyUMUOLjXUX.EB6XG8dx/mcD3CLEU7RC')
ON CONFLICT (id) DO UPDATE SET
  auth_username = COALESCE("configuracion"."auth_username", EXCLUDED.auth_username),
  auth_password_hash = COALESCE("configuracion"."auth_password_hash", EXCLUDED.auth_password_hash);
