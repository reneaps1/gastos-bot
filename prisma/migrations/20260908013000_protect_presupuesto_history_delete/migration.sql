-- El presupuesto Original es evidencia historica una vez que el periodo empieza.
-- Los DELETE de usuario se convierten en Cancelada desde la API; este trigger
-- es una ultima barrera contra deletes directos que se salten ese flujo.
--
-- Las ocurrencias recurrentes sin movimientos se permiten borrar fisicamente:
-- el editor de recurrencias las regenera como plantillas y ese comportamiento
-- no debe romperse al redefinir una serie. Cualquier fila con movimientos queda
-- protegida sin importar si es recurrente o no.
CREATE OR REPLACE FUNCTION protect_presupuesto_history_delete()
RETURNS TRIGGER AS $$
DECLARE
  periodo_iniciado BOOLEAN;
  tiene_movimientos BOOLEAN;
BEGIN
  SELECT COALESCE(
    q."fecha_inicio" <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::date,
    FALSE
  )
  INTO periodo_iniciado
  FROM "quincenas" q
  WHERE q."id" = OLD."quincena_id";

  SELECT EXISTS (
    SELECT 1
    FROM "transacciones" t
    WHERE t."presupuesto_id" = OLD."id"
  ) INTO tiene_movimientos;

  IF COALESCE(tiene_movimientos, FALSE)
     OR (COALESCE(periodo_iniciado, FALSE) AND NOT OLD."recurrente") THEN
    RAISE EXCEPTION
      'Presupuesto % tiene historia y no puede eliminarse fisicamente; usa Cancelada',
      OLD."id"
      USING ERRCODE = '23503';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_protect_presupuesto_history_delete" ON "presupuesto";
CREATE TRIGGER "trg_protect_presupuesto_history_delete"
BEFORE DELETE ON "presupuesto"
FOR EACH ROW
EXECUTE FUNCTION protect_presupuesto_history_delete();

-- Cancelada significa "esta partida no ocurrio". Si ya existen movimientos
-- reales enlazados a la linea, cambiarla a Cancelada esconderia gasto real de
-- agregados de presupuesto. Se bloquea esa transicion para preservar verdad
-- financiera y obligar a resolver/reasignar los movimientos primero.
CREATE OR REPLACE FUNCTION protect_cancelled_presupuesto_with_transactions()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."estado_linea" = 'Cancelada'
     AND OLD."estado_linea" IS DISTINCT FROM 'Cancelada'
     AND EXISTS (
       SELECT 1
       FROM "transacciones" t
       WHERE t."presupuesto_id" = OLD."id"
     ) THEN
    RAISE EXCEPTION
      'Presupuesto % tiene movimientos y no puede marcarse Cancelada',
      OLD."id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_protect_cancelled_presupuesto_with_transactions" ON "presupuesto";
CREATE TRIGGER "trg_protect_cancelled_presupuesto_with_transactions"
BEFORE UPDATE OF "estado_linea" ON "presupuesto"
FOR EACH ROW
EXECUTE FUNCTION protect_cancelled_presupuesto_with_transactions();
