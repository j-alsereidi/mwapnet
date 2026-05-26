Create a one on one chat app, except it's only made for two people.
This means there are no rooms, meetings, etc. Just one always-available meeting for two users to join and video chat through.
It should be peer to peer with fallback only for aggressive NATs or firewalls etc. Indicate which is being used to the user in small text somewhere.
Do not use generic designs/features. Design everything around the assumption that only two users will ever be using it.
For now I'll host the server and expose it with ngrok before we decide where to host it.
Bonus points for wherever you can clone existing code instead of writing it yourself. Don't reinvent the wheel if you don't have to.

Allow users to screenshare (on desktop or mobile). This may influence architecture, but so will the next points too, so plan thoroughly.
The app should have a lobby and a room - this means when you connect, you don't immediately join the room but rather you have a chance to change camera source, turn on/off your mic/camera, etc.
The lobby should show one of 3 statuses: 1. the other is in the meeting, 2. the other is in the lobby, or 3. no one is in the lobby or meeting.
If status 2 is true, it should say it in the room too.
When leaving the meeting, you go back to the lobby. From there, you can rejoin the room as usual. (This is more challenging to implement than it appears on the surface.)