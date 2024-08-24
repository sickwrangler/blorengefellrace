
function scrollToSection(sectionId) {
    const element = document.getElementById(sectionId);
    if (element) {
        window.scrollTo({
            top: element.offsetTop - document.querySelector('header').offsetHeight + 350,
            behavior: 'smooth'
        });
    }
}
