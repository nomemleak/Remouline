// Programs/shout/test_shout.c
// Mini-program exercise: the binary built by the student's Makefile is run
// from the exercise folder (tests run with the exercise folder as working directory).
#include <criterion/criterion.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>

static int run_program(const char *command, char *out, size_t size)
{
    FILE *pipe = popen(command, "r");
    size_t len;

    if (pipe == NULL)
        return -1;
    len = fread(out, 1, size - 1, pipe);
    out[len] = '\0';
    return WEXITSTATUS(pclose(pipe));
}

Test(shout, uppercases_argument)
{
    char out[256];
    int code = run_program("./shout hello", out, sizeof(out));

    cr_assert(code == 0, "Expected exit code 0 but got %d", code);
    cr_assert_str_eq(out, "HELLO\n", "Expected \"HELLO\\n\" but got \"%s\"", out);
}

Test(shout, no_argument_fails)
{
    char out[256];
    int code = run_program("./shout", out, sizeof(out));

    cr_assert(code == 84, "Expected exit code 84 but got %d", code);
}
