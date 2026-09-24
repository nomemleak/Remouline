#include <stdlib.h>
#include <string.h>
#include "count_chars.h"

/* Deliberately broken: no NULL check (crashes) and an off-by-one allocation. */
int count_chars(const char *str, char c)
{
    int count = 0;

    for (int i = 0; str[i] != '\0'; i++)
        count += (str[i] == c);
    return count;
}

char *duplicate_word(const char *word)
{
    size_t len = strlen(word);
    char *copy = malloc(len);

    if (copy == NULL)
        return NULL;
    memcpy(copy, word, len + 1);
    return copy;
}
