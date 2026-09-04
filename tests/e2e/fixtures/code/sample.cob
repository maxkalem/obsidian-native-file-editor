       IDENTIFICATION DIVISION.
       PROGRAM-ID. NOTE-COUNT.
      * COBOL: divisions, PIC clauses, PERFORM.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-COUNT        PIC 9(4) VALUE ZERO.
       01 WS-LIMIT        PIC 9(8) VALUE 5242880.
       01 WS-PATH         PIC X(40) VALUE "a.md".
       PROCEDURE DIVISION.
       MAIN-PARA.
           PERFORM VARYING WS-COUNT FROM 1 BY 1 UNTIL WS-COUNT > 3
               DISPLAY "note " WS-COUNT ": " WS-PATH
           END-PERFORM.
           IF WS-LIMIT > 1000000 THEN
               DISPLAY "limit is large"
           END-IF.
           STOP RUN.
