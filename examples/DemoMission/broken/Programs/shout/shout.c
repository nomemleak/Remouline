#include <stdio.h>
#include "shout.h"

/* Deliberately broken: prints the text unchanged. */
void shout(const char *text)
{
    printf("%s\n", text);
}
