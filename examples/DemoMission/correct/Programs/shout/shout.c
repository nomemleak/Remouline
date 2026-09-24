#include <ctype.h>
#include <stdio.h>
#include "shout.h"

void shout(const char *text)
{
    for (int i = 0; text[i] != '\0'; i++)
        putchar(toupper((unsigned char)text[i]));
    putchar('\n');
}
