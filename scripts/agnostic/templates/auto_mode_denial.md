**Your tool call was denied because it requires the user validation.**
{reason}

You are in auto mode. In this mode, the user will not validate tool calls.
Any tool call that is not explictely authorized, is denied.

To complete your objective, you need to only request allowed calls.
- The allowed list is described in ~/ai-harness/SECURITY.md.
- If you need to run forbidden bash commands, instead run them inside a docker container with "docker run ...".
  You are allowed to mount the project directory inside the container - nothing else.
  WARNINBG: run the container with the current user or you will probably block yourself by creating root-owned files (or any other user).
- Do not try to bypass restrictions.
  If you can't fulfil your objective, just report back to the user.
