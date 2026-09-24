#include <stdlib.h>
#include <string.h>
#include "count_chars.h"

int count_chars(const char *str, char c)
{
    int count = 0;

    if (str == NULL)
        return -1;
    for (int i = 0; str[i] != '\0'; i++)
        count += (str[i] == c);
    return count;
}

char *duplicate_word(const char *word)
{
    size_t len = strlen(word);
    char *copy = malloc(len + 1);

    if (copy == NULL)
        return NULL;
    memcpy(copy, word, len + 1);
    return copy;
}
