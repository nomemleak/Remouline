// Fundamentals/count_chars/test_count_chars.c
#include <criterion/criterion.h>
#include <stdlib.h>
#include <string.h>
#include "count_chars.h"

Test(count_chars, simple_string)
{
    int result = count_chars("hello", 'l');

    cr_assert(result == 2, "Expected 2 but got %d for count_chars(\"hello\", 'l')", result);
}

Test(count_chars, null_string)
{
    int result = count_chars(NULL, 'a');

    cr_assert(result == -1, "Expected -1 but got %d for a NULL string", result);
}

Test(count_chars, duplicate_is_independent)
{
    char *copy = duplicate_word("remouline");

    cr_assert_not_null(copy, "duplicate_word returned NULL");
    cr_assert_str_eq(copy, "remouline", "Expected \"remouline\" but got \"%s\"", copy);
    free(copy);
}
