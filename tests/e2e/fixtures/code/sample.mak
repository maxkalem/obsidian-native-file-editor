# Makefile
CC = cc
all: notes
notes: notes.c
	$(CC) -o notes notes.c
clean:
	rm -f notes
