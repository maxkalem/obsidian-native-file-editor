-- PL/SQL dialect: package body, cursor loop, exception.
CREATE OR REPLACE PROCEDURE count_large(p_limit IN NUMBER) IS
  CURSOR c_notes IS SELECT path, note_size FROM notes WHERE note_size > p_limit;
  v_count NUMBER := 0;
BEGIN
  FOR r IN c_notes LOOP
    v_count := v_count + 1;
    DBMS_OUTPUT.PUT_LINE(r.path || ': ' || TO_CHAR(r.note_size));
  END LOOP;
  DBMS_OUTPUT.PUT_LINE('large: ' || v_count);
EXCEPTION
  WHEN NO_DATA_FOUND THEN NULL;
END count_large;
/
