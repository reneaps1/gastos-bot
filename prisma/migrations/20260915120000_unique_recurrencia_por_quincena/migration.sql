-- Una serie recurrente no puede tener dos lineas en la misma quincena.
--
-- El editor de recurrencias usa createMany({ skipDuplicates: true }) para
-- regenerar las ocurrencias futuras de una serie, pero skipDuplicates no hace
-- absolutamente nada sin un indice UNIQUE que detecte el conflicto: la tabla
-- presupuesto no tenia ninguno, asi que reeditar una serie podia dejar dos
-- lineas identicas en la misma quincena, y las dos sumaban en los agregados.
--
-- (quincena_id, recurrencia_grupo_id) es la clave correcta: en PostgreSQL los
-- NULL se consideran distintos entre si, de modo que las lineas NO recurrentes
-- (grupo NULL) siguen pudiendo repetirse libremente, que es lo que se quiere.
--
-- Por que va dentro de un bloque que captura el error: si la base ya arrastra
-- duplicados de antes, un CREATE UNIQUE INDEX pelado falla y con el se cae el
-- deploy entero. Aqui el indice se crea cuando los datos lo permiten y, si no,
-- deja un WARNING en el log del deploy sin tumbar el servicio. El check 9 de
-- scripts/audit-datos.sql lista los duplicados que hay que resolver a mano, y
-- la ultima consulta de ese script dice si el indice quedo creado o no.
DO $$
BEGIN
  CREATE UNIQUE INDEX "presupuesto_quincena_recurrencia_grupo_key"
    ON "presupuesto" ("quincena_id", "recurrencia_grupo_id");
EXCEPTION
  WHEN duplicate_table THEN
    NULL; -- ya existe: la migracion vive en dos historias contra la misma base
  WHEN unique_violation THEN
    RAISE WARNING 'No se pudo crear presupuesto_quincena_recurrencia_grupo_key: hay lineas recurrentes duplicadas en una misma quincena. Corre el check 9 de scripts/audit-datos.sql, resuelvelas y vuelve a aplicar esta migracion.';
END $$;
