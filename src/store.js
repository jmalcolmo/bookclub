// Tiny shared state: the signed-in user + their profile.
export const store = {
  session: null,
  user: null,
  profile: null,
};

export function setAuth(session, user, profile) {
  store.session = session;
  store.user = user;
  store.profile = profile;
}
