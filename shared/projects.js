/* Filter the checked-in catalog locally; GitHub is never a runtime dependency. */
document.addEventListener('DOMContentLoaded', function () {
  var search = document.getElementById('project-search');
  var cards = Array.from(document.querySelectorAll('.project-card'));
  var count = document.getElementById('project-count');
  function filterProjects() {
    var query = search.value.trim().toLocaleLowerCase();
    var shown = 0;
    cards.forEach(function (card) {
      card.hidden = !card.textContent.toLocaleLowerCase().includes(query);
      if (!card.hidden) shown++;
    });
    count.textContent = shown + ' of ' + cards.length + ' projects';
    document.getElementById('project-empty').hidden = shown !== 0;
  }
  search.addEventListener('input', filterProjects);
  filterProjects();
});
